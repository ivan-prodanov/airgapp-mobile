// cancelled.ts — the one shape every layer uses to say "this work belonged to a
// transport generation that has been retired".
//
// A generation is one gateway + selector + the transports it minted, all built
// from one relay config. It ends when the config changes or the app tears the
// link down (useCarLink's retireGeneration), and everything it still has running
// has to stop THEN. See gateway.ts's `lifetime` for why that matters.
//
// Pure, and checked structurally by `kind` (like session.ts's isTransportDeadError)
// so a PiClient TransportError of kind 'cancelled' counts without an import cycle.

export class GenerationCancelledError extends Error {
  readonly kind = 'cancelled' as const;

  constructor(message = 'cancelled: this transport generation was retired') {
    super(message);
    this.name = 'GenerationCancelledError';
  }
}

export function isCancelledError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { kind?: unknown }).kind === 'cancelled';
}
