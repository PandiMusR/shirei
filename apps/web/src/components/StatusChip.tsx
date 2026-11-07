const labels: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
};

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip chip-${status}`}>{labels[status] ?? status}</span>;
}
