import { Alert } from 'react-native';

// Shared "Remove Vehicle" confirmation, used by the Home vehicle-summary button and
// the Cars-list swipe action. For a REAL (enrolled) car it also reminds the user to
// pull the phone key from the car itself — removing it here only detaches it from
// Airgapp, the car keeps the key until it's deleted in Car Settings → Keys. Demo
// cars have no key, so they skip that note.
export function confirmRemoveVehicle(opts: { name: string; isReal: boolean; onRemove: () => void }): void {
  const { name, isReal, onRemove } = opts;
  const message = isReal
    ? `This removes ${name} from Airgapp. To fully revoke access you also need to delete its phone key on the car: Car Settings → Keys.`
    : `Remove the demo car ${name}?`;
  Alert.alert(`Remove ${name}?`, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove Vehicle', style: 'destructive', onPress: onRemove },
  ]);
}
