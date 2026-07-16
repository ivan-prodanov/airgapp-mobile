# Round 3 — Tesla status-area REAL asset extraction (manifest)

APK set: `com.teslamotors.tesla_4.58.0-4392-4392` (split APK bundle).
All files copied (real bytes) into:
`/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-status-assets/`

Vector XML was read from the already-apktool-decoded base (`scratchpad/base_apktool/res/drawable/`), which is byte-identical source to the compiled AXML in `base.apk` — so the copied `.xml` files are the human-readable decoded form.

---

## 1–2. Header spinner PNGs (BusyIcon: `asset:/img/mini_spinner.png`, `asset:/img/spinner.png`)

| Extracted file | APK source path | Intrinsic size | Format | Alpha | Pre-tinted? | Notes |
|---|---|---|---|---|---|---|
| `mini_spinner.assets-img.png` | `split_assets_pack.apk` → `assets/img/mini_spinner.png` | 36×36 | PNG, 8-bit RGBA (colortype 6) | yes | **No** — pure white `#FFFFFF`, graded alpha arc (maxAlpha=101 ≈ 40%) | The RN **design-system** mini spinner. Single-density asset (RN packs `img/*.png` with no @2x/@3x into `assets/img/`). White mask → runtime `tintColor`. Faint low-opacity arc. |
| `spinner.assets-img.png` | `split_assets_pack.apk` → `assets/img/spinner.png` | 100×100 | PNG, 8-bit RGBA (colortype 6) | yes | **No** — pure white `#FFFFFF`, graded alpha arc (maxAlpha=254) | RN **design-system** large spinner. Single-density. Near-opaque arc gradient, white → runtime-tinted. |
| `mini_spinner.payment.mdpi.png` | `base.apk` → `res/drawable-mdpi-v4/node_modules_tesla_paymentreactnative_assets_img_mini_spinner.png` | 36×36 | PNG, 8-bit gray+alpha (colortype 4) | yes | **No** — white, maxAlpha=101 | **Payment-package** copy (`@tesla/paymentreactnative`). mdpi ONLY (no other densities exist). Pixel-identical artwork to design-system copy; only PNG encoding differs (gray+alpha vs RGBA). |
| `spinner.payment.mdpi.png` | `base.apk` → `res/drawable-mdpi-v4/node_modules_tesla_paymentreactnative_assets_img_spinner.png` | 100×100 | PNG, 8-bit gray+alpha (colortype 4) | yes | **No** — white, maxAlpha=254 | Payment-package large spinner, mdpi ONLY. Same artwork as design-system copy. |

**Density note:** Searched ALL `split_config.*dpi.apk` (ldpi/mdpi/tvdpi/hdpi/xhdpi/xxhdpi/xxxhdpi) and base — there are **NO** `img_mini_spinner`/`img_spinner` density-scaled drawables. The only spinner matches in density splits are `abc_spinner_mtrl_am_alpha.9.png` (AppCompat dropdown-arrow nine-patch — unrelated). So highest (and only) density for the RN spinner art is the single `assets/img/` copy; the payment copy exists only at mdpi. All four are pure-white alpha masks intended to be tinted at runtime (confirmed 0 non-gray opaque pixels).

## 3. Lottie animations

| Extracted file | APK source path | Bytes | Lottie meta | Notes |
|---|---|---|---|---|
| `spinner.json` | `base.apk` → `res/raw/spinner.json` | 5369 | v5.12.2, 100×100, 30fps, frames 0–30, 1 layer, "Comp 1" | Standard rotating spinner (single shape layer). |
| `spinner_ct.json` | `base.apk` → `res/raw/spinner_ct.json` | 26366 | v5.12.2, 100×100, 30fps, frames 0–30, 6 layers, "Comp 1" | Cybertruck-styled spinner (6 layers, angular multi-segment). |

Bonus Lottie also present in `base.apk/res/raw/` (not copied — out of core scope): `loading_spinner.json` (15125 B), `network_spinner_bold.json` (15125 B), `network_spinner_thick.json` (3148 B).

## 4. Charging bolt / plug native vector drawables (widget/notification)
All from `base.apk` → `res/drawable/` (24dp unless noted). All are `<vector>` drawables.

| Extracted file | Source | viewport | fillColor | pathData (key) |
|---|---|---|---|---|
| `ic_charging_bolt.xml` | `res/drawable/ic_charging_bolt.xml` | 24×24 | `#8a8b8b` (grey) | `M12.4712,9.8098C...V2.3761Z` (rounded lightning bolt, evenOdd) |
| `ic_charge_bolt_no_margin.xml` | `res/drawable/ic_charge_bolt_no_margin.xml` | 10×14 | `#66de8e` (**green**) | `M5.0549,5.4668C...V0.2633Z` (tight green bolt — the "actively charging" green glyph) |
| `ic_charging_bolt_cybertruck.xml` | `res/drawable/ic_charging_bolt_cybertruck.xml` | 24×24 | `#8a8b8b` | `M5,14L12,2V10H19L12,22V14H5Z` (angular CT bolt) |
| `ic_charge_plug.xml` | `res/drawable/ic_charge_plug.xml` | 24×24 | `#8a8b8b` | 2 paths: `M8,18.668H16V21.668H8V18.668Z` + plug body `M16,3.668V8.668...` |

## 5. Low-power / cloud-off native vector drawables (`base.apk`/`res/drawable/`)

| Extracted file | viewport | fillColors | pathData (key) / notes |
|---|---|---|---|
| `ic_low_power_mode_on.xml` | 28×28 | body `#f6f6f6`, bar `#ffc107` (**amber**) | Battery outline + amber fill bar `M5.833,11.667h2.917v4.667h-2.917z`. The active low-power (energy-saver) glyph. |
| `ic_low_power_mode_off.xml` | 28×28 | `#898989` both paths | Same shapes, grey (inactive). |
| `ic_low_power_mode_on_disabled.xml` | 28×28 | body `#f6f6f6` @0.5α, bar `#ffc107` @0.5α | Dimmed variant. |
| `ic_low_power_mode_on_cybertruck.xml` | 30×30 | `#ff9d0a` (amber) | CT variant (angular). |
| `ic_low_power_mode_off_cybertruck.xml` | 30×30 | `#898989` | CT inactive. |
| `ic_low_power_mode_on_disabled_cybertruck.xml` | 30×30 | — | CT dimmed. |
| `quantum_ic_cloud_off_vd_theme_24.xml` | 24×24 | `@android:color/white`, `android:tint="?colorControlNormal"` | Google "quantum" cloud-off (no-connection) vector. pathData `M19.35,10.04C18.67,6.59...4.27,4 3,5.27z...` (cloud with slash). Theme-tinted. |

## 6. Battery native drawables (widget / notification — NOT the RN home-header glyph)

| Extracted file | Source | viewport / shape | Notes |
|---|---|---|---|
| `ic_battery.xml` | `base.apk` `res/drawable/ic_battery.xml` | 39×14 `<vector>` | Battery **outline + terminal nub**, fill `#8a8b8b` at `fillAlpha=0.3` (the empty-battery frame). Path 1 = rounded-rect body, path 2 = `M37,4C38.1046,4 39,4.8954 39,6V8...` terminal cap. |
| `shape_battery_rect_inner.xml` | `base.apk` `res/drawable/shape_battery_rect_inner.xml` | `<shape>` rectangle, white solid, left corners rounded (`@dimen/dim_battery_corner_radius_inner`) | The inner **fill bar** (partial charge — left-rounded only). |
| `shape_battery_rect_inner_full.xml` | `base.apk` `res/drawable/shape_battery_rect_inner_full.xml` | `<shape>` rectangle, white solid, all 4 corners rounded | Inner fill at 100% (all corners rounded). |

**Battery finding:** A native battery drawable set DOES exist, but it is the **home-screen widget / notification** battery (used by `res/layout/vehicle_status_battery_view.xml`, `notification_charging_collapsed/expanded.xml`), composed of `ic_battery.xml` (grey 30% outline) + `shape_battery_rect_inner*.xml` (white fill bars) + the green bolt `ic_charge_bolt_no_margin.xml`. The **in-app RN home-header battery glyph** is NOT one of these native drawables — it is bundle-vector (icon-font/vector-path compiled into the Hermes bundle). **Deferred to the header/battery agent** for the RN vector-path extraction (not duplicated here).

## Extra (bonus, not requested)
- `spinner.xml` (`base.apk` `res/drawable/spinner.xml`) copied — it is NOT a spinner image; it's a `<rotate>` animation wrapper with `android:drawable="@null"`, 700ms, from/to 90°. Included for completeness/disambiguation.

---

### Copied files (21) in deliverable folder
PNG (4): mini_spinner.assets-img.png, spinner.assets-img.png, mini_spinner.payment.mdpi.png, spinner.payment.mdpi.png
Lottie (2): spinner.json, spinner_ct.json
Vector/shape XML (15): ic_charging_bolt.xml, ic_charge_bolt_no_margin.xml, ic_charge_plug.xml, ic_charging_bolt_cybertruck.xml, ic_battery.xml, shape_battery_rect_inner.xml, shape_battery_rect_inner_full.xml, ic_low_power_mode_on.xml, ic_low_power_mode_off.xml, ic_low_power_mode_on_disabled.xml, ic_low_power_mode_on_cybertruck.xml, ic_low_power_mode_off_cybertruck.xml, ic_low_power_mode_on_disabled_cybertruck.xml, quantum_ic_cloud_off_vd_theme_24.xml, spinner.xml

### UNRESOLVED / not present
- No `img_mini_spinner`/`img_spinner` density-scaled drawables in any `split_config.*dpi.apk` (RN spinner ships single-density in `assets/img/` only; payment copy mdpi-only). Not a gap — that is the real packaging.
- RN home-header battery glyph: not a native drawable → bundle-vector, deferred to header/battery agent.
