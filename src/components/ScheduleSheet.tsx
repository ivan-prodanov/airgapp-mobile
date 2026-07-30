import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { DayPicker } from './DayPicker';
import { Toggle } from './Toggle';
import { TimeField } from './TimeField';
import {
  type AnySchedule,
  type ChargingSchedule,
  isComplete,
  type PreconditionSchedule,
  toggleDay,
} from '@/state/schedules';

// Bottom-sheet popup for creating/editing one schedule (both kinds). The parent passes a draft (a fresh
// newPrecondition()/newCharging() to create, or an existing schedule to edit) and gets it back on Save.
export function ScheduleSheet({
  visible,
  draft,
  mode,
  onSave,
  onDelete,
  onCancel,
}: {
  visible: boolean;
  draft: AnySchedule | null;
  mode: 'create' | 'edit';
  onSave: (s: AnySchedule) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const { height } = useWindowDimensions();
  // Local working copy so edits are only committed on Save (Cancel discards them).
  const [work, setWork] = useState<AnySchedule | null>(draft);
  useEffect(() => {
    if (visible) setWork(draft);
  }, [visible, draft]);

  if (!work) return null;

  const kindLabel = work.kind === 'precondition' ? 'Precondition' : 'Charging';
  const title = `${mode === 'create' ? 'Create' : 'Edit'} ${kindLabel} Schedule`;
  const canSave = isComplete(work);

  const patch = (p: Partial<PreconditionSchedule> & Partial<ChargingSchedule>) =>
    setWork((w) => (w ? ({ ...w, ...p } as AnySchedule) : w));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={[styles.sheet, { height: Math.min(height * 0.8, height - 60) }]}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.divider} />

        <View style={styles.body}>
          {work.kind === 'precondition' ? (
            <Row label="Precondition by">
              <TimeField value={work.time} onChange={(time) => patch({ time })} />
            </Row>
          ) : (
            <>
              <ChargeField
                label="Start Charging at"
                time={work.startTime}
                enabled={work.startEnabled}
                onTime={(startTime) => patch({ startTime })}
                onEnabled={() => patch({ startEnabled: !work.startEnabled })}
              />
              <ChargeField
                label="End Charging by"
                time={work.endTime}
                enabled={work.endEnabled}
                onTime={(endTime) => patch({ endTime })}
                onEnabled={() => patch({ endEnabled: !work.endEnabled })}
              />
            </>
          )}

          <View style={styles.daysRow}>
            <DayPicker days={work.days} onToggle={(d) => patch({ days: toggleDay(work.days, d) })} />
          </View>

          <Row label="Repeat Weekly">
            <Toggle value={work.repeatWeekly} onToggle={() => patch({ repeatWeekly: !work.repeatWeekly })} />
          </Row>
        </View>

        <View style={styles.footer}>
          <Pressable
            style={[styles.createBtn, !canSave && styles.createBtnDisabled]}
            disabled={!canSave}
            onPress={() => onSave(work)}
          >
            <Text style={[styles.createText, !canSave && styles.createTextDisabled]}>
              {mode === 'create' ? 'Create' : 'Save'}
            </Text>
          </Pressable>
          {/* Below the button: Delete (edit) / Cancel (create), matching the Tesla app's layout. */}
          {mode === 'edit' && onDelete ? (
            <Pressable hitSlop={8} onPress={onDelete} style={styles.underBtn}>
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          ) : (
            <Pressable hitSlop={8} onPress={onCancel} style={styles.underBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

// Charging start/end: the label sits on its own line with the time pill (left) and enable toggle (right)
// on the line below — matching the Tesla app's stacked layout.
function ChargeField({
  label,
  time,
  enabled,
  onTime,
  onEnabled,
}: {
  label: string;
  time: string;
  enabled: boolean;
  onTime: (time: string) => void;
  onEnabled: () => void;
}) {
  return (
    <View style={styles.chargeField}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.chargeRow}>
        <TimeField value={time} disabled={!enabled} onChange={onTime} />
        <Toggle value={enabled} onToggle={onEnabled} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    // Tesla insets the content further than we did (24) — its rows carry a
    // gutter and the buttons sit at 85% width. 30 matches that inward feel.
    paddingHorizontal: 30,
    paddingTop: 20,
  },
  title: {
    // Tesla's sheet title is the H5 tier (below H4=18) — 16, not 18.
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    marginBottom: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: -30,
  },
  body: {
    paddingTop: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: 8,
  },
  chargeField: {
    paddingVertical: 12,
  },
  chargeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  rowLabel: {
    // Tesla's row labels are the design-system `BodyLabel` tier (14/20, +0.1),
    // not 16/24 — this is the "lower size" text.
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: '600',
    color: 'white',
  },
  daysRow: {
    paddingVertical: 14,
  },
  footer: {
    flex: 1,
    justifyContent: 'flex-end',
    // A bit more bottom padding lifts the Create/Cancel group slightly up.
    paddingBottom: 54,
  },
  createBtn: {
    // Full container width (edges aligned with the rows) — 85% read too narrow.
    // Just shorter than our old 56.
    height: 50,
    // Tesla's design-system Specifications.borderRadius = 5, same as every other
    // control in the app. Ours was 14 — "much more rounded than Tesla".
    borderRadius: 5,
    backgroundColor: '#3368FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {
    backgroundColor: '#1E2A4A',
  },
  createText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
  createTextDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
  underBtn: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3368FF',
  },
  deleteText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF453A',
  },
});
