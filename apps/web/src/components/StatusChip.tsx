const labels: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
};

export function statusLabel(status: string): string {
  return labels[status] ?? status;
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip chip-${status}`}>{statusLabel(status)}</span>;
}
