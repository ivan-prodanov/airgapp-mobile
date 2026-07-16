# Authoritative English i18n (extracted from inline bundle locale object)

Source: the English locale is compiled inline into the Hermes bundle as a giant `NewObjectWithBufferLong` object (the module whose `command_error_timeout` = "Command timeout, please try again."). Extracted to `en_locale_pairs.txt` (8,525 key=value pairs). These are the ground-truth English strings; `all_strings.txt` MISSES them because they live in object buffers, not standalone `# String:` literals. Verify any key with: `grep -E "^KEY =" en_locale_pairs.txt`.

## Phone-key (BLE/proximity) status indicator — `phone_key_status_*`
| key | English |
|---|---|
| phone_key_status_connected | Connected |
| phone_key_status_connecting | Connecting |
| phone_key_status_disconnected | Disconnected |
| phone_key_status_not_paired | Set up your phone as a key |
| phone_key_status_needs_permissions | Phone key not recognized. Tap to set up. |
| phone_key_status_bluetooth_disabled | Enable Bluetooth to use your phone as a key |
| phone_key_status_bluetooth_denied | Bluetooth access appears to be disabled for this app |
| phone_key_status_nearby_devices_denied | Enable Nearby devices permission to set up Phone Key |
| phone_key_status_device_connection_permission_denied | Enable Device connection permission to set up Phone Key |
| phone_key_status_camera_access_disabled | Enable Camera Access to scan QR codes |

This is the BLE/phone-key connectivity vocabulary (distinct from cloud). "Connected"/"Connecting"/"Disconnected" describe the BLE link to the car.

## Vehicle liveness on the status screen — `vehicle_status_screen_*`
| key | English | note |
|---|---|---|
| vehicle_status_screen_asleep_age | Asleep {{age}} | ASLEEP state + freshness |
| vehicle_status_screen_last_seen_age | Last seen {{age}} | OFFLINE/unreachable state + freshness ("as of") |

`{{age}}` is a relative-time string (see below). So the header shows e.g. "Asleep 5m ago" / "Last seen 2h ago".

## Freshness / relative-time formats
Vehicle uses `{{age}}` in the two keys above. The relative-time vocabulary seen:
- `vehicle_widget_updated_time` = "{{time}} ago" (home-screen widget freshness)
- Energy "Home Status" feature (`simple_system_status_*`, Powerwall-specific, NOT vehicle) uses: `just_now`="Just now", `30s_ago`="~30s ago", `45s_ago`="~45s ago", `minutes_ago`="{{count}}m ago". These show the relative-time STYLE Tesla uses (approximate, compact) but belong to the energy product.

## Generic connection labels (reused)
- connecting_label = Connecting
- connected = Connected
- reconnecting = Reconnecting
- connection_failed = Connection Failed
- product_error_offline = Connecting...  (offline surfaced as "Connecting...")
- bootstrap_vehicle_access_connecting_vehicle = Connecting to vehicle...
- android_native_vehicle_widget_command_execution_executing = Connecting...  (widget while command runs)

NOTE: exact literal "Waiting for car" and "Vehicle unavailable" were NOT found as EN copy. Closest real strings are "Connecting" / "Connecting to vehicle..." / "Last seen {{age}}". Treat "Waiting for car"/"Vehicle unavailable" as NOT the app's actual copy unless agent C finds them elsewhere.

## Wake copy — NO generic "Waking up…" for normal commands
Only Summon/ops-specific wake strings exist:
- vehicle_ops_enable_summon_wake_failed = Unable to wake up vehicle
- vehicle_ops_enable_summon_time_out_failure = Vehicle may still be waking up
- autopark_summon_error_wake_up_timeout = System wake timed out
- vehicle_soh_warning_for_waking_up_vehicle = Proceeding will wake up your vehicle and may disrupt the battery test.\nDo you still want to proceed?

For normal commands/reads on an asleep car, there is no explicit "Waking up…" label found in EN copy — the app appears to wake the car (VEHICLE_WAKE_UP action) while showing a generic "Connecting…"/pending state. (Confirm with agent D's saga trace.)
