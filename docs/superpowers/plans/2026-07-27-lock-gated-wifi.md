# Lock-Gated WiFi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan spans TWO repos** — `/Users/ivan/Work/airgapp/rpi` (Go, Tasks 1–9) and `/Users/ivan/Work/airgapp/mobile` (React Native, Task 10). Phase 2 must not start until Phase 1's on-car gates have been read.

**Goal:** Take the Pi's WiFi AP down while the car is parked, locked and empty, so the car stops staying awake retrying blocked requests to Tesla — and bring it straight back up the moment anyone approaches or gets in.

**Architecture:** A supervisor goroutine on the Pi (`lockwatch`) subscribes to the *already-existing* unsolicited-frame fan-out on the live BLE session, protobuf-decodes the car's plaintext VCSEC `VehicleStatus` pushes, and evaluates one predicate — `LOCKED && NOT_PRESENT` — to decide whether `hostapd` should be running. It ships in two phases: Phase 1 observes and logs without ever touching the radio, Phase 2 adds enforcement plus two safety valves.

**Tech Stack:** Go 1.23, `github.com/teslamotors/vehicle-command` (Ivan's fork, already in `go.mod`), `google.golang.org/protobuf`, `chi/v5`, `modernc.org/sqlite`, `systemctl` via the repo's `executor.Executor`. Mobile side: TypeScript, existing `PiClient` in `src/ble/transport.ts`.

**Design doc:** `/Users/ivan/Work/airgapp/mobile/docs/superpowers/specs/2026-07-27-lock-gated-wifi-design.md`

## Global Constraints

- **Airgap (safety, non-negotiable):** nothing here may reach Tesla's servers. All signals are car → BLE → Pi, or phone → Pi. No new outbound hosts.
- **Fail open, always.** Every unknown, error, decode failure, panic path and startup state must leave the AP **up**. A wrong state may cost traffic and battery; it must never strand the car offline.
- **The Pi holds no Tesla keys and must not acquire any.** It parses only plaintext unsolicited pushes. It never signs, never decrypts, never polls `GET_STATUS`.
- **Frame opacity for the command path is unchanged.** `Exchange` keeps forwarding opaque bytes. `lockwatch` only inspects frames the pump already classifies as *unsolicited*, i.e. frames no `Exchange` caller wanted.
- **Phase 1 must be incapable of taking the AP down.** Not "configured not to" — no caller of `SetEnabled` exists until **Task 8** wires the enforcer. Tasks 6 and 6.5 create the mechanism and its gate, but nothing invokes them, and `hostapd` stays enabled at boot for the whole of Phase 1 so the car's WiFi behaves exactly as it does today.
- **Go tests must pass with no BLE radio.** Every new type takes an interface that tests substitute, mirroring the existing `bleConn` fake pattern in `tesla_session_test.go`.
- **Predicate, verbatim:** AP down ⟺ `lockState == LOCKED` **AND** `userPresence == NOT_PRESENT`. Every other combination, including every `UNKNOWN`, means AP up.
- **THE AIRGAP OVERRIDES FAIL-OPEN.** Fail-open governs the *lock* axis only. On the *firewall* axis the rule inverts: **if the Pi cannot prove the nftables ruleset is in place, the AP does not come up.** An offline car is recoverable; a car that reached Tesla is not. Any code path that starts `hostapd` without first verifying the filter is a defect, however convenient.
- **Bringing the AP up is the dangerous transition, not taking it down.** This feature turns a once-per-boot event into a several-times-daily one, so every AP-up path must be treated as a fresh chance to leak, never as a resumption of a known-good state.

## File Structure

**Repo `rpi` (Go):**

| Path | Responsibility |
|---|---|
| `internal/services/lockgate.go` (new) | **Pure logic only.** Decode a frame → `LockSignal`; evaluate `LockSignal` + activity lease → AP up/down. No goroutines, no I/O, no clock reads except an injected `now`. |
| `internal/services/lockgate_test.go` (new) | Table-driven tests for the above. |
| `internal/services/lockwatch.go` (new) | The supervisor goroutine: keep a session subscribed, feed frames to `lockgate`, hold current state, call the enforcer. |
| `internal/services/lockwatch_test.go` (new) | Fake session source + fake enforcer; preempt/reap/reconnect/garbage-frame paths. |
| `internal/services/tesla_session.go` (modify) | Add `CurrentSession()`. |
| `internal/services/hotspot.go` (modify) | Add `SetEnabled(bool)` and the airgap gate that refuses to raise the AP over an unverified firewall. |
| `internal/services/firewall.go` (modify) | Add `Verify()` — assert the forward chain is loaded and default-deny. |
| `deploy/setup.sh` (modify) | Stop enabling `hostapd` at boot; netfilterd owns the AP so the gate is the only door. |
| `internal/services/apcontrol.go` (new) | Debounce, max-down watchdog, manual override. The only thing that calls `SetEnabled`. |
| `internal/executor/executor.go` (modify) | Record invocations so service tests can assert *which* command ran. |
| `internal/services/services.go` (modify) | Construct and start `LockWatch`. |
| `internal/handlers/tesla_session.go` (modify) | Add `LockState` POST handler. |
| `internal/handlers/router.go` (modify) | Mount the route. |
| `internal/handlers/dashboard.go` + template (modify) | Status panel + override control. |

**Repo `mobile` (TS):**

| Path | Responsibility |
|---|---|
| `src/ble/transport.ts` (modify) | One new `PiClient` method, `reportLockState`. |
| `src/state/useCarLink.ts` (modify) | Call it from the two places a `VcsecStatus` already lands. |

Splitting `lockgate` (pure) from `lockwatch` (concurrent) is deliberate: the predicate is the part that must be exhaustively correct, and it is only cheap to test exhaustively if it has no goroutines in it.

---

# PHASE 1 — OBSERVE ONLY

## Task 1: The pure lock-gate predicate

**Files:**
- Create: `internal/services/lockgate.go`
- Test: `internal/services/lockgate_test.go`

**Interfaces:**
- Consumes: `universalmessage.RoutableMessage`, `vcsec.FromVCSECMessage`, `vcsec.VehicleStatus` from the vendored fork.
- Produces:
  - `type LockSignal struct { Kind SignalKind; Locked bool; Present bool }`
  - `type SignalKind int` with `SignalNone`, `SignalStatus`, `SignalActivity`
  - `func DecodeLockSignal(frame []byte) LockSignal`
  - `type GateState struct { HaveStatus bool; Locked bool; Present bool; ActivityUntil time.Time }`
  - `func (g GateState) APShouldBeUp(now time.Time) bool`
  - `func (g GateState) Apply(sig LockSignal, now time.Time) GateState`
  - `const ActivityLease = 3 * time.Minute`

- [ ] **Step 1: Write the failing test**

Create `internal/services/lockgate_test.go`:

```go
package services

import (
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	universal "github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/universalmessage"
	"github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/vcsec"
)

// statusFrame builds the exact wire shape of an unsolicited VCSEC status
// push: a RoutableMessage FROM domain 2, with NO requestUuid (that would
// make it a solicited reply) and NO signature data (that would make it
// sealed), carrying a plaintext FromVCSECMessage.VehicleStatus.
func statusFrame(t *testing.T, lock vcsec.VehicleLockState_E, pres vcsec.UserPresence_E) []byte {
	t.Helper()
	inner, err := proto.Marshal(&vcsec.FromVCSECMessage{
		SubMessage: &vcsec.FromVCSECMessage_VehicleStatus{
			VehicleStatus: &vcsec.VehicleStatus{
				VehicleLockState: lock,
				UserPresence:     pres,
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal inner: %v", err)
	}
	outer, err := proto.Marshal(&universal.RoutableMessage{
		FromDestination: &universal.Destination{
			SubDestination: &universal.Destination_Domain{Domain: universal.Domain_DOMAIN_VEHICLE_SECURITY},
		},
		Payload: &universal.RoutableMessage_ProtobufMessageAsBytes{ProtobufMessageAsBytes: inner},
	})
	if err != nil {
		t.Fatalf("marshal outer: %v", err)
	}
	return outer
}

func TestDecodeLockSignalStatus(t *testing.T) {
	f := statusFrame(t, vcsec.VehicleLockState_E_VEHICLELOCKSTATE_LOCKED,
		vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_NOT_PRESENT)
	got := DecodeLockSignal(f)
	if got.Kind != SignalStatus {
		t.Fatalf("Kind = %v, want SignalStatus", got.Kind)
	}
	if !got.Locked || got.Present {
		t.Fatalf("got %+v, want Locked=true Present=false", got)
	}
}

func TestDecodeLockSignalGarbageIsNone(t *testing.T) {
	for name, frame := range map[string][]byte{
		"empty":  {},
		"random": {0xff, 0xff, 0xff, 0xff},
	} {
		if got := DecodeLockSignal(frame); got.Kind != SignalNone {
			t.Errorf("%s: Kind = %v, want SignalNone", name, got.Kind)
		}
	}
}

// A VCSEC frame that is NOT a VehicleStatus (e.g. the ~1 Hz passive-entry
// challenge the car emits on approach) is car ACTIVITY: someone is at the
// car. It must bring the AP up even though it carries no lock state.
func TestDecodeLockSignalNonStatusVcsecIsActivity(t *testing.T) {
	inner, err := proto.Marshal(&vcsec.FromVCSECMessage{
		SubMessage: &vcsec.FromVCSECMessage_CommandStatus{
			CommandStatus: &vcsec.CommandStatus{},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	outer, err := proto.Marshal(&universal.RoutableMessage{
		FromDestination: &universal.Destination{
			SubDestination: &universal.Destination_Domain{Domain: universal.Domain_DOMAIN_VEHICLE_SECURITY},
		},
		Payload: &universal.RoutableMessage_ProtobufMessageAsBytes{ProtobufMessageAsBytes: inner},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := DecodeLockSignal(outer); got.Kind != SignalActivity {
		t.Fatalf("Kind = %v, want SignalActivity", got.Kind)
	}
}

// THE predicate. Exhaustive over lock × presence. Only ONE cell is "down".
func TestAPShouldBeUp(t *testing.T) {
	now := time.Unix(1700000000, 0)
	cases := []struct {
		name   string
		locked bool
		presnt bool
		wantUp bool
	}{
		{"locked and empty — the only down case", true, false, false},
		{"locked but someone inside (driving)", true, true, true},
		{"unlocked and empty", false, false, true},
		{"unlocked and occupied", false, true, true},
	}
	for _, c := range cases {
		g := GateState{HaveStatus: true, Locked: c.locked, Present: c.presnt}
		if got := g.APShouldBeUp(now); got != c.wantUp {
			t.Errorf("%s: APShouldBeUp = %v, want %v", c.name, got, c.wantUp)
		}
	}
}

// Fail-open: before any status has ever been seen, the AP is UP.
func TestAPShouldBeUpWithoutStatusFailsOpen(t *testing.T) {
	now := time.Unix(1700000000, 0)
	if !(GateState{}).APShouldBeUp(now) {
		t.Fatal("zero GateState must fail open (AP up)")
	}
}

// An activity frame overrides a locked-and-empty status for the lease
// duration, then expires back to the status verdict.
func TestActivityLeaseOverridesThenExpires(t *testing.T) {
	now := time.Unix(1700000000, 0)
	g := GateState{HaveStatus: true, Locked: true, Present: false}
	if g.APShouldBeUp(now) {
		t.Fatal("precondition: locked+empty should be down")
	}
	g = g.Apply(LockSignal{Kind: SignalActivity}, now)
	if !g.APShouldBeUp(now.Add(ActivityLease - time.Second)) {
		t.Error("within lease: AP must be up")
	}
	if g.APShouldBeUp(now.Add(ActivityLease + time.Second)) {
		t.Error("after lease: AP must fall back to the status verdict (down)")
	}
}

// A SignalNone frame must not disturb accumulated state.
func TestApplyNoneIsInert(t *testing.T) {
	now := time.Unix(1700000000, 0)
	g := GateState{HaveStatus: true, Locked: true, Present: false}
	if got := g.Apply(LockSignal{Kind: SignalNone}, now); got != g {
		t.Fatalf("SignalNone changed state: %+v -> %+v", g, got)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'LockSignal|APShouldBeUp|ActivityLease|ApplyNone' -v
```

Expected: FAIL to compile — `undefined: DecodeLockSignal`, `undefined: SignalStatus`, `undefined: GateState`.

- [ ] **Step 3: Write the implementation**

Create `internal/services/lockgate.go`:

```go
package services

// lockgate — the PURE half of lock-gated WiFi. Decodes the car's plaintext
// unsolicited VCSEC pushes into a lock/presence verdict and answers one
// question: should the WiFi AP be up?
//
// Pure by construction — no goroutines, no I/O, no clock reads (callers pass
// `now`). That is what makes the predicate cheap to test exhaustively, and the
// predicate is the part that must not be wrong: getting it backwards takes the
// car's network away while someone is driving it.
//
// Why we can read these frames at all without keys: an unsolicited VCSEC push
// has no request to bind a GCM tag to, so the car sends it in the CLEAR. See
// mobile's src/ble/vcsecPush.ts, which does exactly this in TypeScript.

import (
	"time"

	universal "github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/universalmessage"
	"github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/vcsec"
	"google.golang.org/protobuf/proto"
)

// ActivityLease is how long a non-status VCSEC frame holds the AP up. The car
// emits challenge frames at ~1 Hz on approach (see the passive-entry research),
// several seconds before an unlock lands — that head start is what hides the
// WiFi re-association delay. The lease exists so a passer-by who triggers those
// frames and then walks away does not leave the AP up forever: absent any newer
// signal it expires back to whatever the last real status said.
const ActivityLease = 3 * time.Minute

type SignalKind int

const (
	// SignalNone — not a readable car-initiated VCSEC frame. Inert.
	SignalNone SignalKind = iota
	// SignalStatus — a VehicleStatus push. Carries lock + presence.
	SignalStatus
	// SignalActivity — a car-initiated VCSEC frame that is not a status.
	// Carries no lock state, but proves something is happening at the car.
	SignalActivity
)

// LockSignal is one frame's contribution. Locked/Present are meaningful only
// when Kind == SignalStatus.
type LockSignal struct {
	Kind    SignalKind
	Locked  bool
	Present bool
}

// DecodeLockSignal classifies one frame off the session pump's unsolicited
// fan-out. Never panics and never errors — anything unreadable is SignalNone,
// because "we could not parse it" must never be able to influence the AP.
func DecodeLockSignal(frame []byte) LockSignal {
	var rm universal.RoutableMessage
	if err := proto.Unmarshal(frame, &rm); err != nil {
		return LockSignal{Kind: SignalNone}
	}
	// Must be FROM the vehicle-security domain.
	if rm.GetFromDestination().GetDomain() != universal.Domain_DOMAIN_VEHICLE_SECURITY {
		return LockSignal{Kind: SignalNone}
	}
	// A requestUuid means this is a reply to somebody's request, not a push —
	// and that somebody is an Exchange caller whose bytes are not ours to read.
	if len(rm.GetRequestUuid()) > 0 {
		return LockSignal{Kind: SignalNone}
	}
	// Signed/sealed response data means encrypted — we hold no keys.
	if rm.GetSignatureData().GetAES_GCM_ResponseData() != nil {
		return LockSignal{Kind: SignalNone}
	}
	payload := rm.GetProtobufMessageAsBytes()
	if len(payload) == 0 {
		return LockSignal{Kind: SignalNone}
	}
	var fv vcsec.FromVCSECMessage
	if err := proto.Unmarshal(payload, &fv); err != nil {
		return LockSignal{Kind: SignalNone}
	}
	vs := fv.GetVehicleStatus()
	if vs == nil {
		// Car-initiated VCSEC traffic that is not a status: approach
		// challenges, command acks, presence beacons. No lock state, but it
		// means something is going on at the car.
		return LockSignal{Kind: SignalActivity}
	}
	return LockSignal{
		Kind:   SignalStatus,
		Locked: vs.GetVehicleLockState() == vcsec.VehicleLockState_E_VEHICLELOCKSTATE_LOCKED,
		// UserPresence_E is THREE-valued: UNKNOWN, NOT_PRESENT, PRESENT. Test
		// against NOT_PRESENT, not PRESENT — `Present` means "not confirmed
		// absent", so UNKNOWN counts as present and fails open. Testing
		// `== PRESENT` would collapse UNKNOWN into "nobody there" and take the
		// AP down on a locked car whose presence sensor said nothing, which is
		// the exact case the fail-open constraint names.
		Present: vs.GetUserPresence() != vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_NOT_PRESENT,
	}
}

// GateState is the accumulated verdict. The zero value means "we have never
// heard from the car", which fails open.
type GateState struct {
	HaveStatus    bool
	Locked        bool
	Present       bool
	ActivityUntil time.Time
}

// Apply folds one signal into the state.
func (g GateState) Apply(sig LockSignal, now time.Time) GateState {
	switch sig.Kind {
	case SignalStatus:
		g.HaveStatus = true
		g.Locked = sig.Locked
		g.Present = sig.Present
	case SignalActivity:
		g.ActivityUntil = now.Add(ActivityLease)
	}
	return g
}

// APShouldBeUp is THE predicate.
//
// Down in exactly one situation: we have a status, it says LOCKED, it says
// nobody is present, and no recent activity is holding a lease. Everything
// else — every unknown, every parse failure, every state we have not seen — is
// up. Note the presence term is load-bearing, not a refinement: Teslas
// auto-lock at drive-away, so the car reads LOCKED for the whole drive, and
// without `!Present` this would cut the network every time you pull away.
func (g GateState) APShouldBeUp(now time.Time) bool {
	if !g.HaveStatus {
		return true
	}
	if now.Before(g.ActivityUntil) {
		return true
	}
	return !(g.Locked && !g.Present)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'LockSignal|APShouldBeUp|ActivityLease|ApplyNone' -v
```

Expected: PASS, all seven tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/services/lockgate.go internal/services/lockgate_test.go && git commit -m "feat(lockgate): pure predicate for lock-gated WiFi

Decodes the car's plaintext unsolicited VCSEC pushes — readable without keys
because a push has no request to bind a GCM tag to — into one verdict: should
the AP be up. Down in exactly one cell of the lock x presence matrix.

The presence term is load-bearing, not a refinement. Teslas auto-lock at
drive-away, so lock state alone reads LOCKED for the whole drive and would cut
the network every time you pull away."
```

---

## Task 2: `CurrentSession()` accessor

**Files:**
- Modify: `internal/services/tesla_session.go`
- Test: `internal/services/tesla_session_test.go`

**Interfaces:**
- Produces: `func (s *BLESessionService) CurrentSession() (string, bool)` — the id of the one live session, or `false` if none.

Needed because `lockwatch` must attach to *whatever* session is live rather than owning one. If it owned one, every phone `Open` would `preemptExisting` it into a reconnect storm.

- [ ] **Step 1: Write the failing test**

Append to `internal/services/tesla_session_test.go`:

```go
func TestCurrentSessionEmpty(t *testing.T) {
	s := &BLESessionService{sessions: map[string]*internalSession{}}
	if _, ok := s.CurrentSession(); ok {
		t.Fatal("CurrentSession on an empty service must report false")
	}
}

func TestCurrentSessionReturnsLiveID(t *testing.T) {
	sess := newInternalSession("abc123", "VIN0", nil, func() {})
	s := &BLESessionService{sessions: map[string]*internalSession{"abc123": sess}}
	id, ok := s.CurrentSession()
	if !ok || id != "abc123" {
		t.Fatalf("CurrentSession = (%q, %v), want (\"abc123\", true)", id, ok)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run TestCurrentSession -v
```

Expected: FAIL to compile — `s.CurrentSession undefined`.

- [ ] **Step 3: Write the implementation**

Add to `internal/services/tesla_session.go`, next to `get`:

```go
// CurrentSession returns the id of the single live session, if there is one.
//
// Exists for lockwatch, which must SUBSCRIBE to whatever session happens to be
// live rather than owning one of its own: Open calls preemptExisting, so a
// watcher-owned session would be force-closed by every phone Open and spend its
// life reconnecting. The map holds 0 or 1 entries (bleMu serialises Open), so
// "the first one" is unambiguous.
func (s *BLESessionService) CurrentSession() (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id := range s.sessions {
		return id, true
	}
	return "", false
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run TestCurrentSession -v && go test ./internal/services/ -run TestBLE -v
```

Expected: PASS for both, with no regression in the existing session tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/services/tesla_session.go internal/services/tesla_session_test.go && git commit -m "feat(ble-session): expose CurrentSession for the lock watcher

The watcher has to attach to whatever session is live, not own one: Open
preempts, so a watcher-owned session would be force-closed by every phone Open."
```

---

## Task 3: The `lockwatch` supervisor

**Files:**
- Create: `internal/services/lockwatch.go`
- Test: `internal/services/lockwatch_test.go`

**Interfaces:**
- Consumes: `DecodeLockSignal`, `GateState`, `LockSignal` (Task 1); `CurrentSession` (Task 2).
- Produces:
  - `type sessionSource interface { CurrentSession() (string, bool); Open(ctx context.Context, vin string) (*BLESession, error); Subscribe(id string) (int, <-chan []byte, error); Unsubscribe(id string, subID int) }`
  - `type LockWatchStatus struct { HaveStatus bool; Locked bool; Present bool; APShouldBeUp bool; LastSignal time.Time; SessionID string }`
  - `type LockWatchService struct { ... }`
  - `func NewLockWatchService(src sessionSource, vin string) *LockWatchService`
  - `func (s *LockWatchService) SetEnforcer(fn func(up bool))`
  - `func (s *LockWatchService) Start()` / `func (s *LockWatchService) Stop()`
  - `func (s *LockWatchService) Status() LockWatchStatus`
  - `func (s *LockWatchService) Ingest(frame []byte, now time.Time)`
  - `func (s *LockWatchService) ReportExternal(locked, present bool, now time.Time)`

`BLESessionService` satisfies `sessionSource` structurally. Tests substitute a fake — same trick `bleConn` already uses.

`SetEnforcer` is how Phase 1 stays incapable of touching the radio: nothing calls it until Task 8, and the nil enforcer is a no-op.

- [ ] **Step 1: Write the failing test**

Create `internal/services/lockwatch_test.go`:

```go
package services

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/teslamotors/vehicle-command/pkg/protocol/protobuf/vcsec"
)

type fakeSessionSource struct {
	mu      sync.Mutex
	id      string
	ch      chan []byte
	opens   int
	subbed  int
	unsubbd int
}

func (f *fakeSessionSource) CurrentSession() (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.id == "" {
		return "", false
	}
	return f.id, true
}

func (f *fakeSessionSource) Open(ctx context.Context, vin string) (*BLESession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opens++
	f.id = "fake-session"
	return &BLESession{ID: f.id, VIN: vin}, nil
}

func (f *fakeSessionSource) Subscribe(id string) (int, <-chan []byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id != f.id {
		return 0, nil, ErrBLESessionNotFound
	}
	f.subbed++
	f.ch = make(chan []byte, 8)
	return 1, f.ch, nil
}

func (f *fakeSessionSource) Unsubscribe(id string, subID int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.unsubbd++
}

// Ingest is the seam the goroutine uses, so the state machine is testable
// without running the supervisor at all.
func TestIngestLockedAndEmptyWantsAPDown(t *testing.T) {
	now := time.Unix(1700000000, 0)
	s := NewLockWatchService(&fakeSessionSource{}, "VIN0")
	s.Ingest(statusFrame(t,
		vcsec.VehicleLockState_E_VEHICLELOCKSTATE_LOCKED,
		vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_NOT_PRESENT), now)
	st := s.Status()
	if !st.HaveStatus || !st.Locked || st.Present {
		t.Fatalf("status = %+v", st)
	}
	if st.APShouldBeUp {
		t.Error("locked + empty must want the AP down")
	}
}

func TestIngestGarbageLeavesFailOpen(t *testing.T) {
	now := time.Unix(1700000000, 0)
	s := NewLockWatchService(&fakeSessionSource{}, "VIN0")
	s.Ingest([]byte{0xde, 0xad, 0xbe, 0xef}, now)
	if !s.Status().APShouldBeUp {
		t.Fatal("an undecodable frame must leave the AP up")
	}
}

func TestEnforcerCalledOnlyOnTransition(t *testing.T) {
	now := time.Unix(1700000000, 0)
	s := NewLockWatchService(&fakeSessionSource{}, "VIN0")
	var mu sync.Mutex
	var calls []bool
	s.SetEnforcer(func(up bool) { mu.Lock(); calls = append(calls, up); mu.Unlock() })

	locked := statusFrame(t,
		vcsec.VehicleLockState_E_VEHICLELOCKSTATE_LOCKED,
		vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_NOT_PRESENT)
	s.Ingest(locked, now)
	s.Ingest(locked, now.Add(time.Second)) // same verdict — must not re-fire
	s.Ingest(statusFrame(t,
		vcsec.VehicleLockState_E_VEHICLELOCKSTATE_UNLOCKED,
		vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_NOT_PRESENT), now.Add(2*time.Second))

	mu.Lock()
	defer mu.Unlock()
	want := []bool{false, true}
	if len(calls) != len(want) {
		t.Fatalf("enforcer calls = %v, want %v", calls, want)
	}
	for i := range want {
		if calls[i] != want[i] {
			t.Fatalf("enforcer calls = %v, want %v", calls, want)
		}
	}
}

func TestNilEnforcerIsSafe(t *testing.T) {
	now := time.Unix(1700000000, 0)
	s := NewLockWatchService(&fakeSessionSource{}, "VIN0")
	// No SetEnforcer — this is Phase 1. Must not panic.
	s.Ingest(statusFrame(t,
		vcsec.VehicleLockState_E_VEHICLELOCKSTATE_LOCKED,
		vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_NOT_PRESENT), now)
}

func TestReportExternalDrivesTheSameState(t *testing.T) {
	now := time.Unix(1700000000, 0)
	s := NewLockWatchService(&fakeSessionSource{}, "VIN0")
	s.ReportExternal(true, false, now)
	if s.Status().APShouldBeUp {
		t.Fatal("an external locked+empty report must want the AP down")
	}
}

// Losing the session must fail OPEN, discarding the stale verdict.
func TestSessionLossFailsOpen(t *testing.T) {
	now := time.Unix(1700000000, 0)
	s := NewLockWatchService(&fakeSessionSource{}, "VIN0")
	s.Ingest(statusFrame(t,
		vcsec.VehicleLockState_E_VEHICLELOCKSTATE_LOCKED,
		vcsec.UserPresence_E_VEHICLE_USER_PRESENCE_NOT_PRESENT), now)
	if s.Status().APShouldBeUp {
		t.Fatal("precondition: should be down")
	}
	s.noteSessionLost()
	if !s.Status().APShouldBeUp {
		t.Fatal("after losing the BLE link the AP must fail open")
	}
}

// The supervisor opens a session when none exists, and subscribes to it.
func TestSupervisorOpensAndSubscribes(t *testing.T) {
	f := &fakeSessionSource{}
	s := NewLockWatchService(f, "VIN0")
	s.retryDelay = 5 * time.Millisecond
	s.Start()
	defer s.Stop()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		f.mu.Lock()
		ok := f.opens >= 1 && f.subbed >= 1
		f.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("supervisor never opened + subscribed to a session")
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'Ingest|Enforcer|ReportExternal|SessionLoss|Supervisor' -v
```

Expected: FAIL to compile — `undefined: NewLockWatchService`.

- [ ] **Step 3: Write the implementation**

Create `internal/services/lockwatch.go`:

```go
package services

// lockwatch — the CONCURRENT half of lock-gated WiFi. Keeps a subscription to
// the live BLE session's unsolicited fan-out, folds each frame through the pure
// lockgate predicate, and calls the enforcer when the verdict FLIPS.
//
// It deliberately does not own a session. BLESessionService.Open preempts, so a
// watcher-owned session would be force-closed by every phone Open; instead the
// supervisor attaches to whatever session is live and opens one only when there
// is none.
//
// Every failure path here fails OPEN. Losing the link, an unknown session, a
// closed channel — all of them discard the accumulated verdict and go back to
// "AP up", because being wrong must cost traffic, never connectivity.

import (
	"context"
	"log"
	"sync"
	"time"
)

// sessionSource is the slice of BLESessionService lockwatch needs.
// *BLESessionService satisfies it structurally; tests substitute a fake.
type sessionSource interface {
	CurrentSession() (string, bool)
	Open(ctx context.Context, vin string) (*BLESession, error)
	Subscribe(id string) (int, <-chan []byte, error)
	Unsubscribe(id string, subID int)
}

// LockWatchStatus is the read-only snapshot the UI and API render.
type LockWatchStatus struct {
	HaveStatus   bool      `json:"have_status"`
	Locked       bool      `json:"locked"`
	Present      bool      `json:"present"`
	APShouldBeUp bool      `json:"ap_should_be_up"`
	LastSignal   time.Time `json:"last_signal"`
	SessionID    string    `json:"session_id"`
}

type LockWatchService struct {
	src sessionSource
	vin string

	mu         sync.Mutex
	gate       GateState
	lastSignal time.Time
	sessionID  string
	enforcer   func(up bool)
	lastWanted *bool // nil until the first verdict, so the first one always fires

	retryDelay time.Duration
	stop       chan struct{}
	stopOnce   sync.Once
	done       chan struct{}
}

func NewLockWatchService(src sessionSource, vin string) *LockWatchService {
	return &LockWatchService{
		src:        src,
		vin:        vin,
		retryDelay: 10 * time.Second,
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// SetEnforcer installs the AP actuator. Phase 1 never calls this, which is what
// makes Phase 1 structurally incapable of taking the radio down.
func (s *LockWatchService) SetEnforcer(fn func(up bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.enforcer = fn
}

func (s *LockWatchService) Status() LockWatchStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return LockWatchStatus{
		HaveStatus:   s.gate.HaveStatus,
		Locked:       s.gate.Locked,
		Present:      s.gate.Present,
		APShouldBeUp: s.gate.APShouldBeUp(time.Now()),
		LastSignal:   s.lastSignal,
		SessionID:    s.sessionID,
	}
}

// Ingest folds one frame into the verdict and fires the enforcer on a flip.
func (s *LockWatchService) Ingest(frame []byte, now time.Time) {
	sig := DecodeLockSignal(frame)
	if sig.Kind == SignalNone {
		return
	}
	s.mu.Lock()
	s.gate = s.gate.Apply(sig, now)
	s.lastSignal = now
	fn, want := s.settleLocked(now)
	s.mu.Unlock()
	if fn != nil {
		fn(want)
	}
}

// ReportExternal is the phone's re-sync path: the app holds the keys, so it can
// poll GET_STATUS and tell us the authoritative answer. Same state, same flip
// logic — it just did not arrive over BLE.
func (s *LockWatchService) ReportExternal(locked, present bool, now time.Time) {
	s.mu.Lock()
	s.gate = s.gate.Apply(LockSignal{Kind: SignalStatus, Locked: locked, Present: present}, now)
	s.lastSignal = now
	fn, want := s.settleLocked(now)
	s.mu.Unlock()
	if fn != nil {
		fn(want)
	}
}

// noteSessionLost throws away the accumulated verdict. A stale lock state is
// exactly the thing that could hold the AP down while someone drives off, so
// losing the link resets to "we know nothing", which fails open.
func (s *LockWatchService) noteSessionLost() {
	s.mu.Lock()
	s.gate = GateState{}
	s.sessionID = ""
	fn, want := s.settleLocked(time.Now())
	s.mu.Unlock()
	if fn != nil {
		fn(want)
	}
}

// settleLocked computes the verdict and reports whether it changed. Caller must
// hold s.mu; it returns the enforcer rather than calling it so the actuator
// never runs under the lock.
func (s *LockWatchService) settleLocked(now time.Time) (func(bool), bool) {
	want := s.gate.APShouldBeUp(now)
	if s.lastWanted != nil && *s.lastWanted == want {
		return nil, want
	}
	s.lastWanted = &want
	log.Printf("[LOCKWATCH] verdict: ap_up=%v (have_status=%v locked=%v present=%v)",
		want, s.gate.HaveStatus, s.gate.Locked, s.gate.Present)
	return s.enforcer, want
}

func (s *LockWatchService) Start() { go s.supervise() }

func (s *LockWatchService) Stop() {
	s.stopOnce.Do(func() { close(s.stop) })
	<-s.done
}

// supervise keeps exactly one subscription alive for the process lifetime.
func (s *LockWatchService) supervise() {
	defer close(s.done)
	for {
		select {
		case <-s.stop:
			return
		default:
		}
		s.attachAndPump()
		select {
		case <-s.stop:
			return
		case <-time.After(s.retryDelay):
		}
	}
}

// attachAndPump subscribes to the live session (opening one if none exists) and
// consumes frames until the channel closes. Returns on any failure; the caller
// retries after retryDelay.
func (s *LockWatchService) attachAndPump() {
	id, ok := s.src.CurrentSession()
	if !ok {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		sess, err := s.src.Open(ctx, s.vin)
		cancel()
		if err != nil {
			log.Printf("[LOCKWATCH] open session: %v", err)
			return
		}
		id = sess.ID
	}

	subID, ch, err := s.src.Subscribe(id)
	if err != nil {
		log.Printf("[LOCKWATCH] subscribe %s: %v", id, err)
		return
	}
	defer s.src.Unsubscribe(id, subID)
	defer s.noteSessionLost()

	s.mu.Lock()
	s.sessionID = id
	s.mu.Unlock()
	log.Printf("[LOCKWATCH] attached to session %s", id)

	for {
		select {
		case <-s.stop:
			return
		case frame, open := <-ch:
			if !open {
				log.Printf("[LOCKWATCH] session %s closed", id)
				return
			}
			s.Ingest(frame, time.Now())
		}
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'Ingest|Enforcer|ReportExternal|SessionLoss|Supervisor' -v -race
```

Expected: PASS, all six tests, no race warnings.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/services/lockwatch.go internal/services/lockwatch_test.go && git commit -m "feat(lockwatch): supervisor that folds VCSEC pushes into an AP verdict

Attaches to whatever session is live rather than owning one — Open preempts, so
a watcher-owned session would spend its life being force-closed and reconnecting.

Every failure path resets to 'we know nothing', which fails open. A stale lock
verdict is precisely what could hold the AP down while someone drives away.

No enforcer is installed yet: Phase 1 is structurally unable to touch the radio."
```

---

## Task 4: Wire it in, observe-only

**Files:**
- Modify: `internal/services/services.go`
- Modify: `internal/handlers/tesla.go` (add a status endpoint)
- Modify: `internal/handlers/router.go`

**Interfaces:**
- Consumes: `NewLockWatchService`, `LockWatchService.Start`, `LockWatchService.Status`.
- Produces: `GET /api/ble/lock-watch` returning `LockWatchStatus` as JSON.

No enforcer is installed. The AP cannot move.

- [ ] **Step 1: Add the service to the struct and constructor**

In `internal/services/services.go`, add to the `Services` struct after `BLESession`:

```go
	LockWatch   *LockWatchService
```

In `New`, after `bleSession := NewBLESessionService(tesla)` — extract it to a local first, since both the struct literal and the watcher need it:

```go
func New(db *sql.DB, exec *executor.Executor, cfg config.Config) *Services {
	audit := NewAuditService(db)
	trafficLog := NewTrafficLogService(db)
	filter := NewFilterService(db)
	network := NewNetworkService(db, cfg)
	tesla := NewTeslaService(db, audit)
	bleSession := NewBLESessionService(tesla)
	// VIN resolves lazily inside Open when empty, so an unconfigured Pi
	// still constructs cleanly and simply never attaches.
	lockWatch := NewLockWatchService(bleSession, "")
	return &Services{
		Auth:       NewAuthService(db),
		Network:    network,
		Firewall:   NewFirewallService(db, exec, cfg),
		DNS:        NewDNSService(db, exec, cfg),
		Bandwidth:  NewBandwidthService(db, exec, cfg),
		Hotspot:    NewHotspotService(db, exec),
		System:     NewSystemService(exec, cfg),
		Audit:      audit,
		TrafficLog: trafficLog,
		Filter:     filter,
		Spoof:      NewSpoofService(cfg, exec),
		SNIProxy:   NewSNIProxyService(cfg, db, trafficLog),
		Tesla:      tesla,
		TeslaToken: NewTeslaTokenService(db),
		BLESession: bleSession,
		LockWatch:  lockWatch,
		Remote:     NewRemoteService(),
	}
}
```

- [ ] **Step 2: Start the watcher in ApplyAll**

Append to `ApplyAll` in the same file:

```go
	// PHASE 1 — OBSERVE ONLY. No enforcer is installed, so the watcher can
	// read and log the car's lock state but cannot move the radio.
	s.LockWatch.Start()
```

- [ ] **Step 3: Add the status endpoint**

`TeslaHandler` holds **narrow interfaces, not `*services.Services`** (see `bleSessions` at `internal/handlers/tesla.go:66`). Follow that: add a thin interface rather than reaching for a service struct.

In `internal/handlers/tesla.go`, next to the `bleSessions` interface:

```go
// lockWatcher is the slice of *services.LockWatchService these handlers need.
// Narrow, like bleSessions above, so handler tests substitute a fake instead
// of standing up a whole Services graph.
type lockWatcher interface {
	Status() services.LockWatchStatus
}
```

Only `Status()` — Task 9 adds `ReportExternal` when it adds the caller. Declaring it here would leave a method on the interface that nothing invokes.

Add the field to the struct:

```go
type TeslaHandler struct {
	tesla     *services.TeslaService
	tokens    *services.TeslaTokenService
	bleSess   bleSessions
	audit     *services.AuditService
	lockWatch lockWatcher
}
```

and wire it in `NewTeslaHandler`:

```go
		lockWatch: svc.LockWatch,
```

Then the handler. The repo's JSON helpers are `handlers.JSON(w, status, data)` and `handlers.JSONError(w, status, msg)` from `internal/handlers/render.go:57`:

```go
// LockWatchStatus — GET /api/ble/lock-watch. Read-only view of what the lock
// watcher currently believes. Phase 1's entire user interface.
func (h *TeslaHandler) LockWatchStatus(w http.ResponseWriter, r *http.Request) {
	JSON(w, http.StatusOK, h.lockWatch.Status())
}
```

- [ ] **Step 4: Mount the route**

In `internal/handlers/router.go`, inside the `r.Route("/ble", func(r chi.Router) {` block, next to the other `r.Get` lines:

```go
			r.Get("/lock-watch", teslaH.LockWatchStatus)
```

- [ ] **Step 5: Build and run the full suite**

```bash
cd /Users/ivan/Work/airgapp/rpi && go build ./... && go test ./... 2>&1 | tail -20
```

Expected: build succeeds, all packages `ok` or `no test files`.

- [ ] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/services/services.go internal/handlers/tesla.go internal/handlers/router.go && git commit -m "feat(lockwatch): wire the watcher in, observe-only

Starts with no enforcer, so it reads and logs the car's lock state and cannot
move the radio. GET /api/ble/lock-watch exposes what it believes."
```

---

## Task 5: Status panel in the Pi UI

**Files:**
- Modify: `internal/handlers/dashboard.go`
- Modify: the dashboard template under `web/` (find it with the command in Step 1)

**Interfaces:**
- Consumes: `GET /api/ble/lock-watch` from Task 4.

The dashboard is a Go `html/template` at `web/templates/dashboard.html` driven by **Alpine.js** — values render via `x-text="data.<field>"` against the payload from `DashboardHandler.API` (`internal/handlers/dashboard.go:23`), which polls itself. So the card is fed by extending that existing payload, **not** by adding a second fetch to `/api/ble/lock-watch` (that endpoint is bearer-authed for the app; the dashboard is session-authed).

`DashboardHandler` holds `h.svc *services.Services`, so it already has access.

- [ ] **Step 1: Extend the dashboard API payload**

In `internal/handlers/dashboard.go`, inside `API`, before the response is written:

```go
	// Lock-gated WiFi (observe-only in Phase 1): what the watcher believes.
	lw := h.svc.LockWatch.Status()
	lockText := "Unknown"
	if lw.HaveStatus {
		if lw.Locked {
			lockText = "Locked"
		} else {
			lockText = "Unlocked"
		}
	}
	occupantText := "Unknown"
	if lw.HaveStatus {
		if lw.Present {
			occupantText = "Present"
		} else {
			occupantText = "Empty"
		}
	}
	lastSignalText := "never"
	if !lw.LastSignal.IsZero() {
		lastSignalText = time.Since(lw.LastSignal).Truncate(time.Second).String() + " ago"
	}
```

Add these four keys to the map/struct the handler already returns (match its existing shape exactly):

```go
	"lock_state":       lockText,
	"lock_occupant":    occupantText,
	"lock_wifi_verdict": map[bool]string{true: "Should be UP", false: "Should be DOWN"}[lw.APShouldBeUp],
	"lock_last_signal": lastSignalText,
```

- [ ] **Step 2: Add the card to the template**

In `web/templates/dashboard.html`, inside the `<div class="stat-grid">` block (around line 103), add a card matching the existing `stat-card` structure:

```html
        <div class="stat-card">
            <div class="stat-card-head">
                <span class="stat-card-head-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="7" width="9" height="6" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg></span>
                <span>Car lock (observing)</span>
            </div>
            <div class="stat-card-value" x-text="data.lock_state || 'Unknown'">Unknown</div>
            <div class="stat-card-sub"><span>Occupant</span><strong x-text="data.lock_occupant || 'Unknown'"></strong></div>
            <div class="stat-card-sub"><span>WiFi verdict</span><strong x-text="data.lock_wifi_verdict || ''"></strong></div>
            <div class="stat-card-sub"><span>Last signal</span><strong x-text="data.lock_last_signal || 'never'"></strong></div>
        </div>
```

The head label says **"(observing)"** deliberately: in Phase 1 the radio is not under control, and a card that implies otherwise is a lie. Task 8 changes it.

- [ ] **Step 3: Verify it renders**

```bash
cd /Users/ivan/Work/airgapp/rpi && go build ./... && go test ./internal/handlers/ -v 2>&1 | tail -10
```

Expected: build succeeds, handler tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/handlers web && git commit -m "feat(ui): car-lock observation card

Phase 1's readout: lock, occupant, what the WiFi verdict WOULD be, and how
stale the signal is. Labelled so it is unambiguous the radio is not yet
under control."
```

---

## Task 6: `HotspotService.SetEnabled`

**Files:**
- Modify: `internal/services/hotspot.go`
- Test: `internal/services/hotspot_test.go` (create if absent)

**Interfaces:**
- Produces: `func (s *HotspotService) SetEnabled(up bool) error`

Deliberately separate from `Apply()`, which rewrites `hostapd.conf` and restarts. This only starts/stops the unit and never touches config — so a bug here can never corrupt the AP's configuration, only its run state.

- [ ] **Step 1: Add command recording to the Executor**

`executor.Executor` currently only `log.Printf`s in DryRun (`internal/executor/executor.go:33`) — it records nothing, so a test cannot assert *which* unit action ran, and a test that only checks `err == nil` is not worth writing.

In `internal/executor/executor.go`, add to the struct and add `"sync"` to the imports:

```go
type Executor struct {
	DryRun  bool
	Timeout time.Duration

	mu       sync.Mutex
	recorded []string
}
```

Add the recorder and its accessor:

```go
// record keeps invocations so service tests can assert on what was run rather
// than on a bare nil error.
//
// DryRun ONLY. This Executor is a process-lifetime singleton shared by every
// service (cmd/netfilterd/main.go constructs exactly one), and the dashboard
// polls system info + connectivity every 10s — so recording in production
// would append ~4 strings every 10s, forever, on a Raspberry Pi. The real path
// already logs each command to journald via the [EXEC] line, so nothing is
// lost by not recording there.
func (e *Executor) record(cmdStr string) {
	if !e.DryRun {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.recorded = append(e.recorded, cmdStr)
}

// Recorded returns a copy of every command this Executor has been asked to run.
func (e *Executor) Recorded() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.recorded...)
}
```

and call it at the top of `Run`, immediately after `cmdStr` is built and **before** the DryRun branch:

```go
	cmdStr := name + " " + strings.Join(args, " ")
	e.record(cmdStr)
```

- [ ] **Step 2: Write the failing test**

Create or append to `internal/services/hotspot_test.go`:

```go
package services

import (
	"testing"

	"github.com/iulianfsdro/rpi-network-filter/internal/executor"
)

func TestSetEnabledRunsSystemctl(t *testing.T) {
	exec := executor.New(true) // DryRun: records, does not execute
	s := NewHotspotService(nil, exec)

	if err := s.SetEnabled(false); err != nil {
		t.Fatalf("SetEnabled(false): %v", err)
	}
	if err := s.SetEnabled(true); err != nil {
		t.Fatalf("SetEnabled(true): %v", err)
	}

	got := exec.Recorded()
	want := []string{"systemctl stop hostapd", "systemctl start hostapd"}
	if len(got) != len(want) {
		t.Fatalf("recorded = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("recorded = %v, want %v", got, want)
		}
	}
}

// SetEnabled must never touch hostapd.conf — that is the whole reason it is
// separate from Apply.
func TestSetEnabledNeverRestartsOrRewrites(t *testing.T) {
	exec := executor.New(true)
	s := NewHotspotService(nil, exec)
	if err := s.SetEnabled(true); err != nil {
		t.Fatalf("SetEnabled: %v", err)
	}
	for _, cmd := range exec.Recorded() {
		if cmd == "systemctl restart hostapd" {
			t.Fatal("SetEnabled must not restart hostapd — that is Apply's job")
		}
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run TestSetEnabled -v
```

Expected: FAIL to compile — `s.SetEnabled undefined`.

- [ ] **Step 4: Write the implementation**

Add to `internal/services/hotspot.go`:

```go
// SetEnabled starts or stops hostapd without touching its config.
//
// Deliberately NOT part of Apply(): Apply rewrites /etc/hostapd/hostapd.conf
// and restarts. This is called automatically by the lock watcher, potentially
// many times a day, and an automatic path that can rewrite the AP's config is a
// way to lose the AP permanently. This one can only change run state.
func (s *HotspotService) SetEnabled(up bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	action := "stop"
	if up {
		action = "start"
	}
	if _, err := s.exec.Run("systemctl", action, "hostapd"); err != nil {
		return fmt.Errorf("%s hostapd: %w", action, err)
	}
	log.Printf("[HOTSPOT] %s hostapd", action)
	return nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run TestSetEnabled -v && go test ./internal/executor/ ./internal/services/ 2>&1 | tail -5
```

Expected: PASS both new tests, and no regression from the Executor change.

- [ ] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/services/hotspot.go internal/services/hotspot_test.go internal/executor && git commit -m "feat(hotspot): SetEnabled — start/stop without touching config

Kept out of Apply deliberately. This gets called automatically many times a
day; an automatic path able to rewrite hostapd.conf is a way to lose the AP
for good. This one can only change run state."
```

---

## Task 6.5: The airgap gate — never raise the AP over an unverified firewall

**Files:**
- Modify: `internal/services/firewall.go`
- Modify: `internal/services/hotspot.go`
- Modify: `deploy/setup.sh`
- Test: `internal/services/firewall_test.go`, `internal/services/hotspot_test.go`

**Interfaces:**
- Produces:
  - `func (s *FirewallService) Verify() error`
  - `func (s *HotspotService) SetFirewallGate(verify func() error, apply func() error)`
  - `SetEnabled(true)` now returns an error and leaves the AP **down** if the gate cannot be satisfied.

**Why this task exists — and what the real enforcement path is.**

The security decision for the car's HTTPS is made by the **SNI proxy**, not by nftables. The chain is:

1. nftables `prerouting`: `iifname "wlan0" ether saddr <car-mac> tcp dport 443 redirect to :<SNIProxyPort>` (`firewall.go:231`)
2. `SNIProxyService.handle` reads the ClientHello, parses the SNI, and computes `allowed := known && sniAllowed(sni, suffixes)` (`sniproxy.go:195`)
3. Not allowed → `return`, connection closed. Sinkholed.

Three properties of that path are already fail-closed, verified by reading it:

- The proxy binds `":<port>"` — **all interfaces**, not wlan0's address (`sniproxy.go:161`) — and `systemctl stop/start hostapd` does not touch netfilterd. The listener survives every AP cycle.
- `allowedSuffixes` returns `known=false` for an unrecognised client IP, and `allowed` ANDs on it, so a **cold or stale cache denies**. A freshly restarted proxy blocks rather than passes.
- If the proxy were dead while the redirect rule lived, :443 would hit a closed port — refused.

**The one combination that leaks is the inverse: the redirect rule is gone while the proxy is healthy.** Then :443 never reaches the decision at all — it falls to the forward chain, and if the ruleset is empty there is no forward chain either. `deploy/sysctl.conf` sets `net.ipv4.ip_forward=1` unconditionally, so the packet is forwarded. It also loses the `masquerade`, so it egresses with a 192.168.4.x source — whether that reaches Tesla depends on whether the USB LTE modem NATs on its own, which most RNDIS/ECM modems do. **Treat it as reachable.**

Meanwhile `hostapd` is enabled as an independent systemd unit (`deploy/setup.sh:350`), so it raises the AP whether or not any ruleset loaded, and nothing checks. Today that is a once-per-boot exposure; this feature makes it several times a day.

**So `Verify` must assert the SNI redirect rule is present** — the forward policy alone would pass on a ruleset that kept `inet filter` but lost the `ip nat` table, which is precisely a bypass.

Note this task deliberately **inverts** the plan's fail-open rule. Fail-open governs the lock axis. Here, an unverifiable firewall means the AP stays **down**. An offline car is recoverable; a car that reached Tesla is not.

- [ ] **Step 1: Write the failing test**

Append to `internal/services/firewall_test.go`:

```go
// The gate's job is to prove the car's :443 still lands in the SNI proxy.
// A ruleset that kept `inet filter` but lost `ip nat` is a BYPASS, so the
// forward policy alone is not sufficient evidence.
func TestVerifyAcceptsInterceptedRuleset(t *testing.T) {
	s := &FirewallService{cfg: config.Config{SNIProxyPort: 8444}}
	nat := `table ip nat {
	chain prerouting {
		iifname "wlan0" ether saddr aa:bb:cc:dd:ee:ff tcp dport 443 redirect to :8444
	}
}`
	fwd := `table inet filter {
	chain forward {
		type filter hook forward priority filter; policy drop;
	}
}`
	if err := s.verifyOutput(nat, fwd); err != nil {
		t.Fatalf("a ruleset with the SNI redirect and a drop policy must verify: %v", err)
	}
}

func TestVerifyRejectsMissingSNIRedirect(t *testing.T) {
	s := &FirewallService{cfg: config.Config{SNIProxyPort: 8444}}
	nat := `table ip nat {
	chain prerouting {
		type nat hook prerouting priority dstnat; policy accept;
	}
}`
	fwd := `table inet filter {
	chain forward {
		type filter hook forward priority filter; policy drop;
	}
}`
	if err := s.verifyOutput(nat, fwd); err == nil {
		t.Fatal("no SNI redirect means :443 never reaches the decision — must be rejected")
	}
}

func TestVerifyRejectsAcceptPolicy(t *testing.T) {
	s := &FirewallService{cfg: config.Config{SNIProxyPort: 8444}}
	nat := `iifname "wlan0" ether saddr aa:bb:cc:dd:ee:ff tcp dport 443 redirect to :8444`
	fwd := `chain forward { type filter hook forward priority filter; policy accept; }`
	if err := s.verifyOutput(nat, fwd); err == nil {
		t.Fatal("an accept-policy forward chain must be rejected")
	}
}

func TestVerifyRejectsEmptyRuleset(t *testing.T) {
	s := &FirewallService{cfg: config.Config{SNIProxyPort: 8444}}
	if err := s.verifyOutput("", ""); err == nil {
		t.Fatal("an empty ruleset must be rejected — no redirect, no forward chain, ip_forward=1")
	}
}

func TestVerifyReadsFromNft(t *testing.T) {
	// DryRun Run() returns an empty Result, i.e. no listing at all — exactly
	// the "ruleset is not loaded" case.
	exec := executor.New(true)
	s := NewFirewallService(nil, exec, config.Config{SNIProxyPort: 8444})
	if err := s.Verify(); err == nil {
		t.Fatal("Verify must fail when nft returns nothing")
	}
}
```

Append to `internal/services/hotspot_test.go`:

```go
func TestSetEnabledRefusesToStartWhenFirewallUnverified(t *testing.T) {
	exec := executor.New(true)
	s := NewHotspotService(nil, exec)
	s.SetFirewallGate(
		func() error { return fmt.Errorf("forward chain missing") },
		func() error { return nil }, // apply "succeeds" but verify still fails
	)

	err := s.SetEnabled(true)
	if err == nil {
		t.Fatal("SetEnabled(true) must fail when the firewall cannot be verified")
	}
	for _, cmd := range exec.Recorded() {
		if cmd == "systemctl start hostapd" {
			t.Fatal("LEAK: hostapd was started over an unverified firewall")
		}
	}
}

func TestSetEnabledStartsWhenGatePasses(t *testing.T) {
	exec := executor.New(true)
	s := NewHotspotService(nil, exec)
	s.SetFirewallGate(func() error { return nil }, func() error { return nil })

	if err := s.SetEnabled(true); err != nil {
		t.Fatalf("SetEnabled(true): %v", err)
	}
	found := false
	for _, cmd := range exec.Recorded() {
		if cmd == "systemctl start hostapd" {
			found = true
		}
	}
	if !found {
		t.Fatal("a verified firewall must allow the AP up")
	}
}

// Taking the AP DOWN is always safe and must never be gated — otherwise a
// firewall fault would leave the car online, the exact inverse of the point.
func TestSetEnabledDownIsNeverGated(t *testing.T) {
	exec := executor.New(true)
	s := NewHotspotService(nil, exec)
	s.SetFirewallGate(func() error { return fmt.Errorf("broken") }, func() error { return fmt.Errorf("broken") })

	if err := s.SetEnabled(false); err != nil {
		t.Fatalf("SetEnabled(false) must never be blocked by the gate: %v", err)
	}
	found := false
	for _, cmd := range exec.Recorded() {
		if cmd == "systemctl stop hostapd" {
			found = true
		}
	}
	if !found {
		t.Fatal("stop must still have run")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'TestVerify|TestSetEnabledRefuses|TestSetEnabledStarts|TestSetEnabledDown' -v
```

Expected: FAIL to compile — `s.Verify undefined`, `s.verifyOutput undefined`, `s.SetFirewallGate undefined`.

- [ ] **Step 3: Implement `Verify`**

Add to `internal/services/firewall.go`:

```go
// Verify asserts the kernel's CURRENT ruleset still routes the car's HTTPS into
// the SNI proxy, and still default-denies everything else.
//
// The security decision lives in SNIProxyService, not here — but it only ever
// gets to make that decision because prerouting REDIRECTs :443 into it. Lose
// that one rule and :443 bypasses the proxy entirely, which is why this checks
// the redirect and not merely the forward policy: a ruleset that kept
// `inet filter` but lost `ip nat` would pass a forward-only check while being
// a total bypass.
//
// And the forward policy matters because sysctl sets net.ipv4.ip_forward=1
// unconditionally. The deny is not a kernel property; it exists only while a
// table with `policy drop` is loaded. A failed nft -f, a manual
// `nft flush ruleset`, or a missing /etc/nftables.conf on a cold boot all leave
// the car forwarding freely, and nothing else in this daemon would notice.
func (s *FirewallService) Verify() error {
	nat, err := s.exec.Run("nft", "list", "chain", "ip", "nat", "prerouting")
	if err != nil {
		return fmt.Errorf("read nat prerouting: %w", err)
	}
	fwd, err := s.exec.Run("nft", "list", "chain", "inet", "filter", "forward")
	if err != nil {
		return fmt.Errorf("read forward chain: %w", err)
	}
	return s.verifyOutput(nat.Stdout, fwd.Stdout)
}

// verifyOutput is the pure half, so the parsing is testable without nft.
func (s *FirewallService) verifyOutput(nat, fwd string) error {
	if strings.TrimSpace(fwd) == "" {
		return fmt.Errorf("nftables forward chain is absent — with ip_forward=1 nothing is stopping the car")
	}
	if !strings.Contains(fwd, "policy drop") {
		return fmt.Errorf("nftables forward chain is not default-deny")
	}
	// The SNI interception: without this, :443 never reaches the proxy that
	// makes the actual allow/deny decision.
	redirect := fmt.Sprintf("redirect to :%d", s.cfg.SNIProxyPort)
	if !strings.Contains(nat, redirect) {
		return fmt.Errorf("nftables prerouting has no %q — the car's :443 would bypass the SNI proxy", redirect)
	}
	return nil
}
```

**Note on scope:** `Verify` proves the *plumbing*, not the allow-list. It cannot check the SNI proxy's decision, and it does not need to — that path is already fail-closed in three independent ways (all-interfaces bind, `known && allowed`, closed-port refusal), documented above.

- [ ] **Step 4: Implement the gate in `SetEnabled`**

Replace the `SetEnabled` written in Task 6 with the gated version, and add the gate fields to `HotspotService`:

```go
type HotspotService struct {
	db   *sql.DB
	exec *executor.Executor
	mu   sync.Mutex

	verifyFirewall func() error
	applyFirewall  func() error
}

// SetFirewallGate installs the airgap gate. Wired in services.New from
// FirewallService.Verify / .Apply. Kept as funcs rather than a service
// reference so hotspot_test can prove the refusal path without a database.
func (s *HotspotService) SetFirewallGate(verify func() error, apply func() error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.verifyFirewall = verify
	s.applyFirewall = apply
}

// SetEnabled starts or stops hostapd without touching its config.
//
// Deliberately NOT part of Apply(): Apply rewrites /etc/hostapd/hostapd.conf
// and restarts. This is called automatically by the lock watcher, potentially
// many times a day, and an automatic path that can rewrite the AP's config is a
// way to lose the AP permanently. This one can only change run state.
//
// Raising the AP is gated on the firewall being verifiably default-deny;
// LOWERING it never is. That asymmetry is the whole point — a firewall fault
// must not be able to leave the car online.
func (s *HotspotService) SetEnabled(up bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if up && s.verifyFirewall != nil {
		if err := s.verifyFirewall(); err != nil {
			log.Printf("[HOTSPOT] firewall gate FAILED (%v) — reapplying before considering the AP", err)
			if s.applyFirewall != nil {
				if aerr := s.applyFirewall(); aerr != nil {
					log.Printf("[HOTSPOT] firewall reapply failed: %v", aerr)
				}
			}
			if err := s.verifyFirewall(); err != nil {
				// REFUSE. An offline car is recoverable; a car that reached
				// Tesla is not.
				log.Printf("[HOTSPOT] REFUSING to raise the AP — firewall still unverified: %v", err)
				return fmt.Errorf("refusing to start hostapd over an unverified firewall: %w", err)
			}
			log.Printf("[HOTSPOT] firewall gate satisfied after reapply")
		}
	}

	action := "stop"
	if up {
		action = "start"
	}
	if _, err := s.exec.Run("systemctl", action, "hostapd"); err != nil {
		return fmt.Errorf("%s hostapd: %w", action, err)
	}
	log.Printf("[HOTSPOT] %s hostapd", action)
	return nil
}
```

Add `"strings"` to `firewall.go`'s imports if absent, and `"fmt"` to `hotspot_test.go`'s.

- [ ] **Step 5: Wire the gate**

In `internal/services/services.go`, hoist the firewall and hotspot constructions out of the struct literal so the gate can be attached, then reference the locals in the literal:

```go
	firewall := NewFirewallService(db, exec, cfg)
	hotspot := NewHotspotService(db, exec)
	hotspot.SetFirewallGate(firewall.Verify, firewall.Apply)
```

Replace the inline `NewFirewallService(db, exec, cfg)` and `NewHotspotService(db, exec)` in the struct literal with `firewall` and `hotspot`.

**Boot-time hardening is deliberately NOT in this task.** Disabling `hostapd` at boot so netfilterd owns the AP belongs in **Task 8**, because nothing raises the AP until Task 8 wires `APController`. Doing it here would leave the car with no WiFi for the entire 2–3 night Phase 1 observation window.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'TestVerify|TestSetEnabled' -v && go test ./... 2>&1 | tail -10
```

Expected: PASS all seven tests, no regressions.

- [ ] **Step 7: On-Pi verification (do not skip — this is the whole point)**

Split by what can actually run at this commit. **Nothing calls `SetEnabled` yet**, so any check that needs the gate to *fire* belongs to Task 8; the checks here prove the ruleset is the shape `Verify` expects, which is the failure mode that would otherwise surface at 2am as "the WiFi never comes back".

**Runnable now (Phase 1):**

```bash
# 0. Pin the renderer. Verify parses nft's OWN re-render, not our generated
#    file — if this nft version spells the rule differently, Verify fails
#    permanently and the feature bricks while every unit test stays green.
sudo nft --version

# 1. THE HIGH-VALUE CHECK: the exact strings Verify matches must be present.
#    Substitute the car's MAC (lowercase) and the configured SNIProxyPort.
sudo nft -nn list chain ip nat prerouting | grep -F "$(printf '%s' "<car-mac>" | tr 'A-Z' 'a-z')" | grep -F 'redirect to :8444'
sudo nft -nn list chain inet filter forward | grep -F 'policy drop'
#    Both MUST print a line. An empty result means Verify will refuse forever.

# 2. Atomicity: a reload must never leave an observable gap.
sudo systemctl restart netfilterd && sudo nft -nn list chain ip nat prerouting | grep -F 'redirect to :8444'

# 3. THE LEAK TEST (informational, settles an open question). Drop only the nat
#    table — SNI proxy healthy, redirect gone. This is the exact bypass shape.
sudo nft delete table ip nat
#    From the car's browser load any non-allow-listed HTTPS site, and watch:
sudo tcpdump -ni eth1 'tcp port 443' -c 20
#    Traffic egressing means the LTE modem NATs for us and an empty ruleset IS
#    reachable. Record the answer either way.
sudo nft -f /etc/nftables.conf   # restore IMMEDIATELY

# 4. The AP cycle must not break the LAN. nf-wlan0 is oneshot/RemainAfterExit
#    so it will NOT re-run — if stopping hostapd drops wlan0's address, dnsmasq
#    cannot lease on the way back up and the car gets no IP.
sudo systemctl stop hostapd && sleep 5 && sudo systemctl start hostapd
ip addr show wlan0 | grep 192.168.4.1   # MUST still be there
systemctl is-active dnsmasq             # MUST be active
journalctl -u dnsmasq -n 20 | grep DHCPACK   # car must re-lease
```

**Gates:**
- Check 1 must print both lines. If either is empty, **stop** — `Verify` cannot match this nft version's output, and Task 8 would ship a gate that refuses forever.
- Check 4 must show wlan0 keeping its address and the car getting a `DHCPACK`. If not, `nf-wlan0.service` has to be re-run as part of the AP-up path, and that belongs in `SetEnabled` before Task 8.
- Check 3 is informational, but **record the answer** — it decides whether an empty ruleset is a real leak or merely a broken car.

**Deferred to Task 8 (needs a caller for the gate to fire):**

- Gate refuses over a flushed ruleset: `sudo nft flush ruleset`, ask for the AP, `systemctl is-active hostapd` MUST print `inactive` and the journal MUST show `REFUSING to raise the AP`.
- Gate refuses for the RIGHT REASON on the real bypass shape: `sudo nft delete table ip nat` (leaving `inet filter` intact), ask for the AP — must refuse, and the journal must name the **missing redirect**, not the forward chain.
- **Positive control** — healthy ruleset, ask for the AP, `systemctl is-active hostapd` MUST print `active` with no `REFUSING` line. Without this, a `Verify` that can never match would pass every refusal test by refusing for the wrong reason.

- [ ] **Step 8: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/services && git commit -m "feat(airgap): never raise the AP over an unverified firewall

The security decision for the car's HTTPS is the SNI proxy's, not nftables'.
nftables only supplies the prerouting REDIRECT that delivers :443 to it — so the
bypass shape is \"redirect rule gone, proxy healthy\", and a forward-policy-only
check would sail straight past it. Verify asserts the redirect, plus the forward
chain's drop policy because sysctl sets ip_forward=1 unconditionally and the
deny exists only while a table with 'policy drop' is loaded.

Raising the AP is now gated on that proof; lowering it never is. This
deliberately inverts the fail-open rule used everywhere else in the feature: an
offline car is recoverable, a car that reached Tesla is not.

Boot-time hardening (netfilterd owning hostapd's lifecycle) is NOT here — it
belongs with the first caller in Task 8. Disabling hostapd at boot now, while
nothing raises the AP, would leave the car with no WiFi for the whole
observation period."
```

---

# PHASE 2 — ENFORCEMENT

> **GATE — do not start Phase 2 until Phase 1 has run on the car for 2–3 nights and its gates have been read.** See "On-car gates" at the end of this plan. If **G1** fails (no pushes on an idle connection), stop: the design does not work and Phase 2 must not ship.

## Task 7: Debounce, watchdog and override

**Files:**
- Create: `internal/services/apcontrol.go`
- Test: `internal/services/apcontrol_test.go`

**Interfaces:**
- Consumes: `HotspotService.SetEnabled` (Task 6).
- Produces:
  - `type OverrideMode string` with `OverrideAuto = "auto"`, `OverrideForceOn = "force-on"`, `OverrideForceOff = "force-off"`
  - `type APController struct { ... }`
  - `func NewAPController(apply func(up bool) error) *APController`
  - `func (c *APController) Want(up bool)`
  - `func (c *APController) SetOverride(m OverrideMode)`
  - `func (c *APController) Override() OverrideMode`
  - `const APDebounce = 2 * time.Second`
  - `const APMaxDown = 12 * time.Hour`

Three jobs, all of them about not trusting the verdict too much: **debounce** so a burst of pushes cannot thrash the radio; **watchdog** so the AP can never stay down past a ceiling even if the verdict is confidently wrong; **override** so there is a way out without SSH.

- [ ] **Step 1: Write the failing test**

Create `internal/services/apcontrol_test.go`:

```go
package services

import (
	"sync"
	"testing"
	"time"
)

type apRecorder struct {
	mu    sync.Mutex
	calls []bool
}

func (r *apRecorder) apply(up bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, up)
	return nil
}

func (r *apRecorder) snapshot() []bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]bool(nil), r.calls...)
}

func waitFor(t *testing.T, d time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}

func TestDebounceCoalescesBurst(t *testing.T) {
	r := &apRecorder{}
	c := NewAPController(r.apply)
	c.debounce = 30 * time.Millisecond
	c.Start()
	defer c.Stop()

	// A flapping burst that settles on "down".
	c.Want(false)
	c.Want(true)
	c.Want(false)

	waitFor(t, time.Second, func() bool { return len(r.snapshot()) >= 1 })
	time.Sleep(80 * time.Millisecond)
	if got := r.snapshot(); len(got) != 1 || got[0] != false {
		t.Fatalf("calls = %v, want exactly [false]", got)
	}
}

func TestForceOnIgnoresWantDown(t *testing.T) {
	r := &apRecorder{}
	c := NewAPController(r.apply)
	c.debounce = 10 * time.Millisecond
	c.Start()
	defer c.Stop()

	c.SetOverride(OverrideForceOn)
	c.Want(false)
	waitFor(t, time.Second, func() bool { return len(r.snapshot()) >= 1 })
	if got := r.snapshot(); got[len(got)-1] != true {
		t.Fatalf("force-on must keep the AP up, got %v", got)
	}
}

func TestForceOffIgnoresWantUp(t *testing.T) {
	r := &apRecorder{}
	c := NewAPController(r.apply)
	c.debounce = 10 * time.Millisecond
	c.Start()
	defer c.Stop()

	c.SetOverride(OverrideForceOff)
	c.Want(true)
	waitFor(t, time.Second, func() bool { return len(r.snapshot()) >= 1 })
	if got := r.snapshot(); got[len(got)-1] != false {
		t.Fatalf("force-off must keep the AP down, got %v", got)
	}
}

// The watchdog: however confident the verdict, the AP comes back up after the
// ceiling. This is the valve that covers a CONFIDENTLY WRONG "locked", which
// fail-open does not.
func TestWatchdogRaisesAPAfterMaxDown(t *testing.T) {
	r := &apRecorder{}
	c := NewAPController(r.apply)
	c.debounce = 5 * time.Millisecond
	c.maxDown = 60 * time.Millisecond
	c.watchdogTick = 5 * time.Millisecond
	c.Start()
	defer c.Stop()

	c.Want(false)
	waitFor(t, time.Second, func() bool {
		got := r.snapshot()
		return len(got) >= 1 && got[0] == false
	})
	waitFor(t, 2*time.Second, func() bool {
		got := r.snapshot()
		return len(got) >= 2 && got[len(got)-1] == true
	})
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'Debounce|ForceOn|ForceOff|Watchdog' -v
```

Expected: FAIL to compile — `undefined: NewAPController`.

- [ ] **Step 3: Write the implementation**

Create `internal/services/apcontrol.go`:

```go
package services

// apcontrol — the actuator between the lock verdict and the radio.
//
// Three jobs, all of them about not trusting the verdict too much:
//   debounce — a burst of pushes must not thrash hostapd;
//   watchdog — the AP can NEVER stay down past a ceiling, however confident
//              the verdict is. This is the valve that covers a confidently
//              WRONG "locked"; fail-open only covers "unknown";
//   override — a way out from the UI without SSH, because this feature's
//              failure mode is a car with no network.

import (
	"log"
	"sync"
	"time"
)

const (
	// APDebounce coalesces bursts. The car often emits several frames in a
	// second around a lock transition.
	APDebounce = 2 * time.Second
	// APMaxDown is the hard ceiling on how long the AP may stay down.
	APMaxDown = 12 * time.Hour
	// apWatchdogTick is how often the ceiling is checked.
	apWatchdogTick = 1 * time.Minute
)

type OverrideMode string

const (
	OverrideAuto     OverrideMode = "auto"
	OverrideForceOn  OverrideMode = "force-on"
	OverrideForceOff OverrideMode = "force-off"
)

type APController struct {
	apply func(up bool) error

	debounce     time.Duration
	maxDown      time.Duration
	watchdogTick time.Duration

	mu       sync.Mutex
	want     bool
	override OverrideMode
	applied  *bool     // nil until the first apply
	downAt   time.Time // when the AP was last driven down

	kick     chan struct{}
	stop     chan struct{}
	stopOnce sync.Once
	done     chan struct{}
}

func NewAPController(apply func(up bool) error) *APController {
	return &APController{
		apply:        apply,
		debounce:     APDebounce,
		maxDown:      APMaxDown,
		watchdogTick: apWatchdogTick,
		want:         true, // fail open before anyone says otherwise
		override:     OverrideAuto,
		kick:         make(chan struct{}, 1),
		stop:         make(chan struct{}),
		done:         make(chan struct{}),
	}
}

// Want records the desired state. Non-blocking; the loop settles it.
func (c *APController) Want(up bool) {
	c.mu.Lock()
	c.want = up
	c.mu.Unlock()
	select {
	case c.kick <- struct{}{}:
	default:
	}
}

func (c *APController) SetOverride(m OverrideMode) {
	c.mu.Lock()
	c.override = m
	c.mu.Unlock()
	select {
	case c.kick <- struct{}{}:
	default:
	}
}

func (c *APController) Override() OverrideMode {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.override
}

func (c *APController) Start() { go c.run() }

func (c *APController) Stop() {
	c.stopOnce.Do(func() { close(c.stop) })
	<-c.done
}

func (c *APController) run() {
	defer close(c.done)
	tick := time.NewTicker(c.watchdogTick)
	defer tick.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-tick.C:
			c.settle()
		case <-c.kick:
			// Debounce: wait out the quiet period, absorbing further kicks.
			timer := time.NewTimer(c.debounce)
		drain:
			for {
				select {
				case <-c.stop:
					timer.Stop()
					return
				case <-c.kick:
					if !timer.Stop() {
						<-timer.C
					}
					timer.Reset(c.debounce)
				case <-timer.C:
					break drain
				}
			}
			c.settle()
		}
	}
}

// settle resolves want + override + watchdog into one target and applies it if
// it differs from what is already applied.
func (c *APController) settle() {
	c.mu.Lock()
	target := c.want
	switch c.override {
	case OverrideForceOn:
		target = true
	case OverrideForceOff:
		target = false
	}
	// Watchdog: the ceiling beats everything except an explicit force-off.
	if !target && c.override != OverrideForceOff &&
		!c.downAt.IsZero() && time.Since(c.downAt) >= c.maxDown {
		log.Printf("[APCTRL] watchdog: AP has been down %v (ceiling %v) — raising",
			time.Since(c.downAt).Truncate(time.Minute), c.maxDown)
		target = true
	}
	if c.applied != nil && *c.applied == target {
		c.mu.Unlock()
		return
	}
	c.applied = &target
	if target {
		c.downAt = time.Time{}
	} else {
		c.downAt = time.Now()
	}
	fn := c.apply
	c.mu.Unlock()

	if err := fn(target); err != nil {
		log.Printf("[APCTRL] apply(up=%v) failed: %v", target, err)
		// Forget what we applied so the next settle retries rather than
		// believing a state we never reached.
		c.mu.Lock()
		c.applied = nil
		c.mu.Unlock()
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/services/ -run 'Debounce|ForceOn|ForceOff|Watchdog' -v -race
```

Expected: PASS, all four tests, no race warnings.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/services/apcontrol.go internal/services/apcontrol_test.go && git commit -m "feat(apcontrol): debounce, watchdog and override for the AP actuator

The watchdog is the valve that covers a confidently WRONG 'locked' — fail-open
only covers 'unknown'. Whatever the verdict, the AP comes back up at the ceiling
and re-syncs.

A failed apply forgets what it believes it applied, so the next settle retries
rather than trusting a state it never reached."
```

---

## Task 8: Connect the verdict to the radio

**Files:**
- Modify: `internal/services/services.go`
- Modify: `internal/handlers/tesla.go`
- Modify: `internal/handlers/router.go`
- Modify: the dashboard template from Task 5

**Interfaces:**
- Consumes: `LockWatchService.SetEnforcer` (Task 3), `NewAPController` (Task 7), `HotspotService.SetEnabled` (Task 6).
- Produces: `POST /api/ble/lock-watch/override` accepting `{"mode":"auto"|"force-on"|"force-off"}`.

**Carried forward from Task 3's review — three properties this task must honour:**

1. **The enforcer must not block.** `LockWatchService` calls it with `applyMu` held, and `Ingest` blocks on that mutex — so a slow enforcer stalls the frame-pump goroutine, and the session fan-out drops frames once its 8-deep buffer fills (`internal/services/tesla_session.go`). The wiring below satisfies this because `APController.Want` only sets a field and kicks a buffered channel; the `systemctl` shell-out happens on the controller's own goroutine. **Do not "simplify" this by calling `hotspot.SetEnabled` directly from the enforcer** — that would put a multi-hundred-millisecond shell-out inside the pump's critical path.
2. **`SetEnforcer` asserts the current verdict on install**, and `Stop()` can actuate (it fails open on shutdown, so a stopping process never leaves the radio down). Both are deliberate. Confirm the shutdown actuation cannot hang a reboot — `systemctl start hostapd` during a system stop should be quick, but verify on the Pi, and if it can block, bound it.
3. **Wiring order is not load-bearing**, because `SetEnforcer` forces its assert regardless of what settled before it. Do not reintroduce an ordering dependency.

**Carried forward from Task 6.5's review — three ungated paths that raise the AP, which only become live when this task disables `hostapd` at boot. All three must be closed HERE:**

4. **`HotspotService.Apply()` runs `systemctl restart hostapd` with no gate at `internal/services/hotspot.go:132`, and it HAS production callers** — `internal/services/services.go:77` (`ApplyAll`, every daemon start) and `internal/handlers/settings.go:82`. Today that is masked because `hostapd` is enabled at boot anyway; the moment Step 6 disables it, `ApplyAll` becomes *the* thing that first raises the AP, over an unverified firewall. Route `Apply`'s restart through the same gate, or have it stop-then-`SetEnabled(true)`.
5. **`ApplyAll` only logs a `Firewall.Apply()` failure and then raises the AP anyway** — `internal/services/services.go:68-70` logs, `services.go:77` restarts hostapd nine lines later. **This is a defect that exists today**, not merely a Task 8 consequence. If the firewall failed to apply, the AP must not come up. Cite these exact lines when implementing; "gate `Hotspot.Apply`" alone will not lead you to the ordering bug.
6. **`deploy/netfilterd.service:4` declares `Wants=hostapd.service`**, so starting netfilterd pulls the AP up through systemd, bypassing every line of Go. With `Restart=always` / `RestartSec=5`, a crash loop re-pulls it. This is a **unit-file edit, not a code change** — easy to lose next to the code work. Remove that `Wants` when disabling the unit, or the boot hardening is cosmetic.

**Also add a periodic re-verify.** `Verify` runs once at raise time; nothing re-checks while the AP is up, so a later `nft flush ruleset` is never noticed. A ticker that re-verifies and calls `SetEnabled(false)` on failure closes the TOCTOU. Note this composes correctly with the gate's asymmetry: the watchdog's action is `SetEnabled(false)`, which is ungated on every path, so a firewall fault can always take the AP *down* even when it cannot bring it back. Size this as a new feature, not a fix.

**Operator runbook note (new failure mode introduced by Task 6.5):** `Verify` now reads the SQLite DB via `loadDeviceSnapshot`. A DB fault — locked, corrupt, bad permissions — makes `Verify` error, then `applyFirewall` reads the same DB and also fails, then the re-verify fails, so **the AP refuses and stays down indefinitely**. That is correctly fail-closed under this task's inversion, but it is a new way for the car to go offline. The journal signature is `load device snapshot for verify`. Put it in the runbook.

- [ ] **Step 1: Add the controller to Services**

In `internal/services/services.go`, add to the struct:

```go
	APControl   *APController
```

In `New`, after `lockWatch := ...`:

```go
	hotspot := NewHotspotService(db, exec)
	apControl := NewAPController(hotspot.SetEnabled)
	lockWatch.SetEnforcer(func(up bool) { apControl.Want(up) })
```

and use `hotspot` / `apControl` in the struct literal in place of the inline `NewHotspotService(db, exec)`, adding `APControl: apControl,`.

- [ ] **Step 2: Start the controller**

In `ApplyAll`, replace the Phase 1 comment block with:

```go
	// PHASE 2 — the verdict now drives the radio. APController owns debounce,
	// the max-down watchdog and the manual override; LockWatch only says what
	// it wants.
	s.APControl.Start()
	s.LockWatch.Start()
```

- [ ] **Step 3: Add the override endpoint**

Extend the narrow-interface pattern from Task 4. In `internal/handlers/tesla.go`, next to `lockWatcher`:

```go
// apController is the slice of *services.APController these handlers need.
type apController interface {
	SetOverride(m services.OverrideMode)
	Override() services.OverrideMode
}
```

Add `apControl apController` to the `TeslaHandler` struct and `apControl: svc.APControl,` to `NewTeslaHandler`. Then:

```go
// SetLockWatchOverride — POST /api/ble/lock-watch/override.
// Body: {"mode": "auto" | "force-on" | "force-off"}
func (h *TeslaHandler) SetLockWatchOverride(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		JSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	mode := services.OverrideMode(body.Mode)
	switch mode {
	case services.OverrideAuto, services.OverrideForceOn, services.OverrideForceOff:
	default:
		JSONError(w, http.StatusBadRequest, "mode must be auto, force-on or force-off")
		return
	}
	h.apControl.SetOverride(mode)
	JSON(w, http.StatusOK, map[string]string{"mode": string(mode)})
}
```

- [ ] **Step 4: Mount the route and extend the status payload**

In `internal/handlers/router.go`, inside the `/ble` group:

```go
			r.Post("/lock-watch/override", teslaH.SetLockWatchOverride)
```

Extend `LockWatchStatus` (the handler from Task 4) to include the current override:

```go
func (h *TeslaHandler) LockWatchStatus(w http.ResponseWriter, r *http.Request) {
	JSON(w, http.StatusOK, struct {
		services.LockWatchStatus
		Override services.OverrideMode `json:"override"`
	}{
		LockWatchStatus: h.lockWatch.Status(),
		Override:        h.apControl.Override(),
	})
}
```

- [ ] **Step 5: Update the UI card**

In `internal/handlers/dashboard.go`, add the override to the payload built in Task 5:

```go
	"lock_override": string(h.svc.APControl.Override()),
```

In `web/templates/dashboard.html`, change the card head label from `Car lock (observing)` to `Car lock → WiFi`, and add the three-way control below the existing `stat-card-sub` rows:

```html
            <div class="stat-card-sub">
                <span>Override</span>
                <strong x-text="data.lock_override || 'auto'"></strong>
            </div>
            <div class="stat-card-actions">
                <button type="button" @click="setLockOverride('auto')">Auto</button>
                <button type="button" @click="setLockOverride('force-on')">Force WiFi on</button>
                <button type="button" @click="setLockOverride('force-off')">Force WiFi off</button>
            </div>
```

and add the handler to the page's Alpine component, alongside its existing methods:

```js
            setLockOverride(mode) {
                fetch('/api/ble/lock-watch/override', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode }),
                }).then(() => this.refresh());
            },
```

Read the component's existing method block first and match its refresh call — if the poller is named something other than `refresh`, use that name.

**Note the auth seam:** `/api/ble/*` is bearer-authed while the dashboard is session-authed, so this `fetch` will 401 as written. Mount the override route **outside** the bearer group — next to the session-authed `/api/*` routes in `router.go` — or give the dashboard its own session-authed alias that calls the same handler. Pick one and make it work before moving on; a control that silently 401s is worse than no control, because this is the escape hatch.

- [ ] **Step 6: Make netfilterd the only thing that can raise the AP**

This lands **here**, not in Task 6.5, because only now does anything raise the AP. Doing it earlier would have left the car with no WiFi for the whole Phase 1 observation window.

In `deploy/setup.sh:350`, remove `hostapd` from the enable list and disable it explicitly:

```bash
systemctl enable nf-wlan0 nftables dnsmasq netfilterd >/dev/null
# hostapd is NOT enabled: netfilterd owns the AP's lifecycle and raises it only
# after the firewall verifies the SNI redirect is live. Leaving hostapd enabled
# would let the AP come up at boot independently of any ruleset — and with
# net.ipv4.ip_forward=1 and no nft table loaded, that is an open car.
systemctl disable hostapd >/dev/null 2>&1 || true
```

`netfilterd.service` already declares `After=hostapd.service`, now a no-op ordering hint for a disabled unit — harmless, and left alone so an operator who re-enables hostapd manually still gets the old ordering.

**Verify the startup path actually raises the AP.** `APController` starts with `want = true`, and `ApplyAll` must call `Firewall.Apply()` *before* `APControl.Start()` so the first `settle()` passes the gate. Confirm that ordering in `ApplyAll`, then prove it on the Pi:

```bash
sudo systemctl restart netfilterd && sleep 10 && systemctl is-active hostapd
```

Expected: `active`. If the AP does not come up on a clean restart, **stop and fix it before committing** — every other property in this plan is downstream of the car having WiFi at all.

- [ ] **Step 7: Build and run the full suite**

```bash
cd /Users/ivan/Work/airgapp/rpi && go build ./... && go test ./... -race 2>&1 | tail -20
```

Expected: build succeeds, all packages pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/ web deploy/setup.sh && git commit -m "feat(lockwatch): connect the verdict to the radio

The AP now goes down when the car is locked and empty and comes back up on any
other signal — including the approach frames, which arrive seconds before the
unlock and hide most of the re-association delay.

Ships with the override control in the same commit: this feature's failure mode
is a car with no network, so the way out must not require SSH."
```

---

## Task 9: The phone re-sync endpoint

**Files:**
- Modify: `internal/handlers/tesla.go`
- Modify: `internal/handlers/router.go`
- Test: `internal/handlers/tesla_session_test.go`

**Interfaces:**
- Consumes: `LockWatchService.ReportExternal` (Task 3).
- Produces: `POST /api/ble/lock-state` accepting `{"locked": bool, "present": bool}`.

The Pi holds no keys and cannot poll `GET_STATUS`. The phone can, and already does every 20 s while linked. This is how a missed BLE edge gets corrected.

- [ ] **Step 1: Write the failing test**

Append to `internal/handlers/tesla_session_test.go`:

First extend the `lockWatcher` interface from Task 4 — it currently declares only `Status()`:

```go
type lockWatcher interface {
	Status() services.LockWatchStatus
	ReportExternal(locked, present bool, now time.Time)
}
```

That interface is what makes the test cheap — no `Services` graph, just a fake:

```go
// fakeLockWatcher records what the handler forwarded.
type fakeLockWatcher struct {
	status   services.LockWatchStatus
	reports  int
	gotLock  bool
	gotPres  bool
}

func (f *fakeLockWatcher) Status() services.LockWatchStatus { return f.status }

func (f *fakeLockWatcher) ReportExternal(locked, present bool, now time.Time) {
	f.reports++
	f.gotLock = locked
	f.gotPres = present
}

func TestReportLockStateRejectsGarbage(t *testing.T) {
	f := &fakeLockWatcher{}
	h := &TeslaHandler{lockWatch: f}
	req := httptest.NewRequest(http.MethodPost, "/api/ble/lock-state",
		strings.NewReader("not json"))
	rec := httptest.NewRecorder()
	h.ReportLockState(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if f.reports != 0 {
		t.Error("a malformed body must not reach the watcher")
	}
}

func TestReportLockStateForwardsToWatcher(t *testing.T) {
	f := &fakeLockWatcher{}
	h := &TeslaHandler{lockWatch: f}
	req := httptest.NewRequest(http.MethodPost, "/api/ble/lock-state",
		strings.NewReader(`{"locked":true,"present":false}`))
	rec := httptest.NewRecorder()
	h.ReportLockState(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if f.reports != 1 || !f.gotLock || f.gotPres {
		t.Fatalf("forwarded (reports=%d locked=%v present=%v), want (1, true, false)",
			f.reports, f.gotLock, f.gotPres)
	}
}
```

The end-to-end assertion — that locked+empty actually produces an AP-down verdict — already lives in `TestReportExternalDrivesTheSameState` (Task 3), against the real service. This layer only needs to prove the handler parses and forwards.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/handlers/ -run TestReportLockState -v
```

Expected: FAIL to compile — `h.ReportLockState undefined`.

- [ ] **Step 3: Write the implementation**

In `internal/handlers/tesla.go`:

```go
// ReportLockState — POST /api/ble/lock-state.
// Body: {"locked": bool, "present": bool}
//
// The phone's re-sync path. The car's BLE push is edge-triggered with no
// heartbeat, and the Pi holds no keys to poll GET_STATUS with — so if the link
// blips across a lock transition the Pi's view goes stale and nothing on the Pi
// can correct it. The app CAN poll, and does, every 20 s while linked. This is
// where that authoritative answer lands.
func (h *TeslaHandler) ReportLockState(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Locked  bool `json:"locked"`
		Present bool `json:"present"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		JSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	h.lockWatch.ReportExternal(body.Locked, body.Present, time.Now())
	JSON(w, http.StatusOK, h.lockWatch.Status())
}
```

- [ ] **Step 4: Mount the route**

In `internal/handlers/router.go`, inside the `/ble` group:

```go
			r.Post("/lock-state", teslaH.ReportLockState)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/ivan/Work/airgapp/rpi && go test ./internal/handlers/ -run TestReportLockState -v && go build ./...
```

Expected: PASS both tests, build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/rpi && git add internal/handlers && git commit -m "feat(api): POST /api/ble/lock-state for the phone's re-sync

The push is edge-triggered with no heartbeat and the Pi holds no keys to poll
with, so a blip across a transition leaves a stale verdict nothing on the Pi can
correct. The app polls every 20s while linked; this is where that lands."
```

---

## Task 10: Phone-side re-sync

**Files:**
- Modify: `/Users/ivan/Work/airgapp/mobile/src/ble/transport.ts`
- Modify: `/Users/ivan/Work/airgapp/mobile/src/state/useCarLink.ts`
- Test: `/Users/ivan/Work/airgapp/mobile/src/ble/transport.test.ts`

**Interfaces:**
- Consumes: `POST /api/ble/lock-state` (Task 9); `VcsecStatus` from `src/ble/telemetry.ts` (`lockState: LockState`, `userPresence: PresenceState`).
- Produces: `PiClient.reportLockState(locked: boolean, present: boolean): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `src/ble/transport.test.ts` (read the file first and match how the existing tests inject their fake `fetch`):

```ts
test('reportLockState POSTs locked+present to /api/ble/lock-state', async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fakeFetch = async (url: string, init: any) => {
    calls.push({ url, body: init.body });
    return { ok: true, status: 200, json: async () => ({}) } as any;
  };
  const c = new PiClient({ baseUrl: 'https://pi.example', token: 't' }, fakeFetch as any);

  await c.reportLockState(true, false);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/api/ble/lock-state'));
  assert.deepEqual(JSON.parse(calls[0].body), { locked: true, present: false });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ivan/Work/airgapp/mobile && node --test src/ble/transport.test.ts 2>&1 | tail -20
```

Expected: FAIL — `c.reportLockState is not a function`.

- [ ] **Step 3: Add the client method**

In `src/ble/transport.ts`, next to `closeSession`:

```ts
  // reportLockState — tell the Pi what the car's lock/presence actually is.
  //
  // The Pi drives its WiFi AP off this: it hears the car's BLE pushes itself,
  // but those are edge-triggered with no heartbeat and the Pi holds no keys to
  // poll GET_STATUS with. We do. So every authoritative read we take is also a
  // chance to correct a stale verdict on the Pi.
  //
  // Best-effort by contract: callers must not await it on any user-facing path.
  async reportLockState(locked: boolean, present: boolean): Promise<void> {
    await this.request<unknown>(
      'POST',
      `${API_PREFIX}/lock-state`,
      { locked, present },
      DEFAULT_TIMEOUT_MS,
    );
  }
```

Add `reportLockState` to the `PiTransport` interface if `PiClient` declares `implements PiTransport` and the interface is used structurally elsewhere — read the interface first; if adding it would force unrelated implementers to change, leave it off the interface and call it through a narrowed type.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/ivan/Work/airgapp/mobile && node --test src/ble/transport.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Call it from both places a status lands**

In `src/state/useCarLink.ts`, add a helper near `handleVcsecPush` (around line 1230):

```ts
  // Mirror every authoritative VCSEC read to the Pi, which uses it to decide
  // whether its WiFi AP should be up. Fire-and-forget and deduped: this must
  // never delay or break the telemetry path it rides on.
  const lastReportedLockRef = useRef<string>('');
  const reportLockToPi = useCallback((status: VcsecStatus) => {
    const locked = status.lockState === 'locked';
    // UNKNOWN presence counts as PRESENT — the Pi's predicate only takes the
    // AP down when it is sure nobody is in the car.
    const present = status.userPresence !== 'not_present';
    const key = `${locked}:${present}`;
    if (key === lastReportedLockRef.current) return;
    lastReportedLockRef.current = key;
    const pi = piClientRef.current;
    if (!pi) return;
    void pi.reportLockState(locked, present).catch(() => {
      // Best-effort. A failed report just means the Pi keeps its current
      // verdict, which fails open. Allow a retry on the next read.
      lastReportedLockRef.current = '';
    });
  }, []);
```

`piClientRef` may not exist under that name — read how the Pi transport is held in this file (see the `wrapPiClient` call around line 602) and use whatever ref/accessor already holds it. Do **not** construct a second client.

Then call it in exactly two places:

In `handleVcsecPush`, immediately after `if (!status) return;`:

```ts
    reportLockToPi(status);
```

In the poll path, immediately after `const st = await gw.readVcsecStatus();`:

```ts
        reportLockToPi(st);
```

- [ ] **Step 6: Typecheck and run the suite**

```bash
cd /Users/ivan/Work/airgapp/mobile && npx tsc --noEmit 2>&1 | tail -20 && node --test src/ble/ 2>&1 | tail -10
```

Expected: no type errors; all `src/ble` tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile && git add src/ble/transport.ts src/ble/transport.test.ts src/state/useCarLink.ts && git commit -m "feat(carlink): mirror authoritative lock state to the Pi

The Pi decides whether its WiFi AP should be up from the car's BLE pushes, but
those are edge-triggered with no heartbeat and it holds no keys to poll with.
We do. Every read we take is a chance to correct a stale verdict.

UNKNOWN presence reports as PRESENT: the AP only comes down when we are sure
nobody is in the car.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## On-car gates

These are measurements against the real car, not code. **G1 is blocking for Phase 2.**

**After Phase 1 (Tasks 1–5), deploy and leave it for 2–3 nights:**

- **G1 (BLOCKING)** — do pushes arrive on an *idle* connection? Park and lock the car with no phone activity, then check `journalctl -u netfilterd | grep LOCKWATCH` and `GET /api/ble/lock-watch`. If `last_signal` never updates while the car sits, **stop** — the whole design rests on this and Phase 2 must not ship.
- **G5** — what does the standing BLE connection itself cost? Note the car's SoC at park and again in the morning, across those nights. This number is only measurable now, before the WiFi saving masks it. There is no automated path: the Pi holds no keys and cannot read SoC, and the app does not run overnight.
- **G3** — does a key-card unlock produce a push? Lock the car, walk away, come back and unlock with the card only. Check whether the watcher's state flips.
- **G2 (informational)** — drive with the watcher observing and record whether `locked` reads true and `present` reads true throughout. The predicate is already correct either way; this just tells you which enum the car uses.
- **Approach frames** — check whether `SignalActivity` fires as you walk up, before the unlock. If it does not, the re-association delay will be fully visible in Phase 2 and the activity lease is dead weight.

**After Phase 2:**

- **G0 (the point of the whole exercise)** — drain delta. Same manual SoC readings, one week with the feature on, against the Phase 1 baseline with comparable parking. **If drain does not move, the traffic was a symptom of the car being awake for other reasons, not a cause — and the honest outcome is deleting the feature.** For calibration: a Pi 4 draws roughly 4 W continuously, on the order of 100 Wh/day, which is itself a real fraction of typical vampire drain.
- **G4** — rejoin behaviour. Time from unlock to the car having working internet. If it is bad even with the activity lease, revisit the mechanism.
