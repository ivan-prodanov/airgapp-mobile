// bleEnroll.ts — pure builder for the VCSEC add-key enrollment message sent
// over direct BLE (no Pi, no session, no ECDH). See
// docs/superpowers/plans/tesla-ble-transport-spec.md §7.
//
// This message is fundamentally different from every other message this
// codebase builds: it is NOT a UniversalMessage.RoutableMessage and does
// NOT go through session.ts/gateway.ts's counter/AAD/ECDH machinery. It's
// an unauthenticated, unsigned (despite the field name — see below)
// one-shot write: connect, send this once, done. The car does not confirm;
// the operator approves by tapping an existing NFC key card on the
// console.
//
// Nested structure (verified field-by-field against src/ble/proto/gen.d.ts
// — VCSEC members keep their proto casing, e.g. `WhitelistOperation` and
// `PublicKeyRaw` keep a leading capital):
//
//   VCSEC.ToVCSECMessage {
//     signedMessage (1) = VCSEC.SignedMessage {
//       protobufMessageAsBytes (2) = <marshaled UnsignedMessage below>
//       signatureType (3) = VCSEC.SignatureType.SIGNATURE_TYPE_PRESENT_KEY (2)
//     }
//   }
//
//   VCSEC.UnsignedMessage {
//     WhitelistOperation (16, oneof subMessage) = VCSEC.WhitelistOperation {
//       addKeyToWhitelistAndAddPermissions (5) = VCSEC.PermissionChange {
//         key (1) = VCSEC.PublicKey { PublicKeyRaw (1) = <65-byte SEC1 point> }
//         keyRole (4) = Keys.Role.ROLE_DRIVER (3)
//       }
//       metadataForKey (6) = VCSEC.KeyMetadata {
//         keyFormFactor (1) = VCSEC.KeyFormFactor.KEY_FORM_FACTOR_IOS_DEVICE (6)
//       }
//     }
//   }
//
// Pure — no ble-plx, no RN, node-testable (see bleEnroll.test.ts, appended
// to package.json's `test` script).

import * as pb from './proto/gen';
import { encodeMessage } from './proto';

const PUBLIC_KEY_RAW_LENGTH = 65;
const PUBLIC_KEY_RAW_PREFIX = 0x04; // SEC1 uncompressed-point marker

// buildAddKeyMessage marshals the VCSEC.ToVCSECMessage add-key payload for
// publicKeyRaw (the device's 65-byte SEC1 uncompressed P-256 point,
// 0x04||X||Y — see keystore.ts's generateDeviceKeys). Throws if the input
// isn't shaped like a raw SEC1 point; this is the device's own generated
// pubkey, so a bad shape here is a caller bug, not user input to recover
// from gracefully.
export function buildAddKeyMessage(publicKeyRaw: Uint8Array): Uint8Array {
  if (publicKeyRaw.length !== PUBLIC_KEY_RAW_LENGTH || publicKeyRaw[0] !== PUBLIC_KEY_RAW_PREFIX) {
    throw new Error(
      `buildAddKeyMessage: publicKeyRaw must be a ${PUBLIC_KEY_RAW_LENGTH}-byte SEC1 uncompressed point ` +
        `(0x04||X||Y), got ${publicKeyRaw.length} byte(s)` +
        (publicKeyRaw.length > 0 ? ` starting 0x${publicKeyRaw[0].toString(16).padStart(2, '0')}` : ''),
    );
  }

  const unsignedBytes = encodeMessage(pb.VCSEC.UnsignedMessage, {
    WhitelistOperation: {
      addKeyToWhitelistAndAddPermissions: {
        key: { PublicKeyRaw: publicKeyRaw },
        keyRole: pb.Keys.Role.ROLE_DRIVER,
      },
      metadataForKey: {
        // IOS_DEVICE (not CLOUD_KEY): a phone paired directly over BLE IS an
        // iOS device key, and this drives the car's default label — CLOUD_KEY
        // shows as "unknown key", IOS_DEVICE as a phone key. There is no
        // free-text name field in the BLE add-key protocol (Tesla only names
        // keys at the account/cloud level, which we never touch); the owner
        // renames it in the vehicle UX.
        keyFormFactor: pb.VCSEC.KeyFormFactor.KEY_FORM_FACTOR_IOS_DEVICE,
      },
    },
  });

  return encodeMessage(pb.VCSEC.ToVCSECMessage, {
    signedMessage: {
      protobufMessageAsBytes: unsignedBytes,
      signatureType: pb.VCSEC.SignatureType.SIGNATURE_TYPE_PRESENT_KEY,
    },
  });
}
