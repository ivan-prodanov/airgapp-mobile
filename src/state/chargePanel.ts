// The home charge panel's show/hide contract, recovered from VehicleHomeScreen
// @4561054-4561600. Two rules, and they are not symmetric.
//
//   const chargePortOpen         = useTypedSelector(getSelectedVehicleChargePortOpen)
//   const prev                   = usePrevious(chargePortOpen)
//   const [showCharge, toggleCharge] = useState(chargePortOpen)
//
//   visible   = chargePortOpen || showCharge
//   useEffect(() => {
//     if (showCharge && prev === true && !chargePortOpen) toggleCharge(false)
//   }, [showCharge, prev === true && !chargePortOpen])
//
// Extracted here as plain predicates because the screen has no test coverage and
// this logic has already been got wrong once (it used to sync on every port
// transition, which let you hide the panel while plugged in).

/**
 * The row-list gate, verbatim.
 *
 * An OR, so while the port is OPEN the panel is always up and the battery tap
 * cannot dismiss it — the tap only decides anything once you are unplugged.
 */
export function isChargePanelVisible(chargePortOpen: boolean, showCharge: boolean): boolean {
  return chargePortOpen || showCharge;
}

/**
 * Whether unplugging should clear the manual toggle.
 *
 * THIS IS AN EDGE, not a level: they compute it from `usePrevious`, so it fires
 * only on the open -> closed TRANSITION.
 *
 * Ours used a bare `if (!chargePortOpen) setShowCharge(false)` and got the right
 * behaviour only because the effect's dependency array happened to be
 * `[chargePortOpen]`. That is a trap: adding `showCharge` to those deps — the
 * obvious response to an exhaustive-deps warning — would make tapping the
 * battery on an unplugged car hide the panel again immediately. Stating the edge
 * outright removes the trap.
 *
 * @param prevPortOpen `undefined` on the first render, exactly like usePrevious.
 */
export function shouldClearShowCharge(
  prevPortOpen: boolean | undefined,
  chargePortOpen: boolean,
  showCharge: boolean,
): boolean {
  return showCharge && prevPortOpen === true && !chargePortOpen;
}
