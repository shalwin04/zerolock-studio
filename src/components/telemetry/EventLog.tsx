'use client';

import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTelemetryStore } from '@/hooks/useTelemetry';
import { TelemetryEvent } from '@/types/telemetry';

const EVENT_STYLES: Record<string, string> = {
  start: 'bg-white/10 text-white/70',
  query: 'bg-white/5 text-white/50',
  conflict: 'bg-white/15 text-white/90',
  retry: 'bg-white/10 text-white/60',
  commit: 'bg-white/10 text-white/70',
  abort: 'bg-white/15 text-white/80',
};

function formatTimestamp(ts: number, baseTime?: number): string {
  const relative = baseTime ? ts - baseTime : 0;
  return `+${(relative / 1000).toFixed(2)}s`;
}

function EventItem({ event, baseTime }: { event: TelemetryEvent; baseTime?: number }) {
  let details = '';

  switch (event.type) {
    case 'query':
      if ('sql' in event) {
        details = event.sql.substring(0, 50) + (event.sql.length > 50 ? '...' : '');
      }
      break;
    case 'conflict':
      if ('code' in event) {
        details = `${event.code}${event.subcode ? ` (${event.subcode})` : ''}`;
      }
      break;
    case 'retry':
      if ('attempt' in event) {
        details = `Attempt ${event.attempt}, delay ${event.delayMs}ms`;
      }
      break;
    case 'commit':
    case 'abort':
      if ('totalMs' in event) {
        details = `${event.totalMs}ms`;
      }
      break;
  }

  return (
    <div className="flex items-start gap-2 py-1.5 text-xs border-b border-white/[0.04] last:border-0">
      <span className="font-mono text-white/30 w-14 shrink-0">
        {formatTimestamp(event.timestamp, baseTime)}
      </span>
      <span
        className={`${EVENT_STYLES[event.type]} text-[10px] px-1.5 py-0.5 rounded uppercase font-medium`}
      >
        {event.type}
      </span>
      <span className="font-mono text-white/40 truncate flex-1">
        {event.txnId.substring(0, 8)}
      </span>
      {details && (
        <span className="text-white/30 truncate max-w-32">{details}</span>
      )}
    </div>
  );
}

export function EventLog() {
  const events = useTelemetryStore((state) => state.events);
  const scrollRef = useRef<HTMLDivElement>(null);

  const baseTime = events.length > 0 ? events[0].timestamp : undefined;

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="h-full flex flex-col bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-sm font-medium text-white/90">Event Log</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">
          {events.length} events
        </span>
      </div>

      {/* Events */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="px-4 py-2">
            {events.length > 0 ? (
              events.slice(-100).map((event, i) => (
                <EventItem key={i} event={event} baseTime={baseTime} />
              ))
            ) : (
              <div className="text-center text-white/30 text-xs py-8">
                No events yet
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
