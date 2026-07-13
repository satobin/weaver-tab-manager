import { AlertTriangle, CircleHelp, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const POPOVER_GAP = 6;
const POPOVER_GUTTER = 8;
const POPOVER_MAX_HEIGHT = 560;
const POPOVER_MAX_WIDTH = 560;

interface PopoverPosition {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

interface RuleHelpExampleProps {
  comparisonResult?: string;
  pattern?: string;
  urls: readonly string[];
}

function RuleHelpExample({ comparisonResult, pattern, urls }: RuleHelpExampleProps) {
  return (
    <div className="dedupe-rule-help-example">
      {pattern ? (
        <div className="dedupe-rule-help-example-part dedupe-rule-help-example-pattern">
          <span className="dedupe-rule-help-example-label">Rule pattern</span>
          <code>{pattern}</code>
        </div>
      ) : null}
      <div className="dedupe-rule-help-example-part">
        <span className="dedupe-rule-help-example-label">
          {pattern ? 'Example URLs included by this pattern' : 'Example URLs'}
        </span>
        <div className="dedupe-rule-help-example-values">
          {urls.map((url) => (
            <code key={url}>{url}</code>
          ))}
        </div>
      </div>
      {comparisonResult ? (
        <div className="dedupe-rule-help-example-part dedupe-rule-help-example-result">
          <span className="dedupe-rule-help-example-label">Comparison result</span>
          <code>{comparisonResult}</code>
          <small>Both example URLs are treated as the same page.</small>
        </div>
      ) : null}
    </div>
  );
}

function getPopoverPosition(trigger: HTMLButtonElement): PopoverPosition {
  const bounds = trigger.getBoundingClientRect();
  const width = Math.min(POPOVER_MAX_WIDTH, window.innerWidth - POPOVER_GUTTER * 2);
  const left = Math.min(
    Math.max(POPOVER_GUTTER, bounds.right - width),
    Math.max(POPOVER_GUTTER, window.innerWidth - width - POPOVER_GUTTER),
  );
  const belowSpace = window.innerHeight - bounds.bottom - POPOVER_GAP - POPOVER_GUTTER;
  const aboveSpace = bounds.top - POPOVER_GAP - POPOVER_GUTTER;
  const openBelow = belowSpace >= 360 || belowSpace >= aboveSpace;
  const availableSpace = openBelow ? belowSpace : aboveSpace;
  const maxHeight = Math.max(160, Math.min(POPOVER_MAX_HEIGHT, availableSpace));
  const top = openBelow
    ? bounds.bottom + POPOVER_GAP
    : Math.max(POPOVER_GUTTER, bounds.top - POPOVER_GAP - maxHeight);
  return { left, maxHeight, top, width };
}

export function DedupeRuleHelpPopover() {
  const dialogId = useId();
  const headingId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      setPosition(getPopoverPosition(triggerRef.current));
    }
  }, []);

  const closeHelp = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !dialogRef.current?.contains(target)
      ) {
        closeHelp(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHelp(true);
      }
    };
    const handlePositionChange = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handlePositionChange);
    window.addEventListener('scroll', handlePositionChange, true);
    queueMicrotask(() => dialogRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handlePositionChange);
      window.removeEventListener('scroll', handlePositionChange, true);
    };
  }, [closeHelp, open, updatePosition]);

  return (
    <div className="dedupe-rule-help">
      <button
        ref={triggerRef}
        type="button"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) {
            closeHelp(false);
          } else {
            updatePosition();
            setOpen(true);
          }
        }}
      >
        <CircleHelp aria-hidden="true" size={15} />
        <span>Help</span>
      </button>

      {open && position
        ? createPortal(
            <div
              ref={dialogRef}
              className="dedupe-rule-help-popover"
              id={dialogId}
              role="dialog"
              aria-labelledby={headingId}
              tabIndex={-1}
              style={position}
            >
              <header>
                <div>
                  <h4 id={headingId}>Custom rules help</h4>
                  <p>
                    Each rule has two parts: a pattern chooses which URLs are included, then a
                    comparison method decides when those URLs are the same page.
                  </p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close custom rule help"
                  title="Close"
                  onClick={() => closeHelp(true)}
                >
                  <X aria-hidden="true" size={17} />
                </button>
              </header>

              <div className="dedupe-rule-help-content">
                <section>
                  <span className="dedupe-rule-help-step-label">Step 1 · URL pattern</span>
                  <h5>Choose which URLs the rule includes</h5>
                  <p>
                    Omit <code>https://</code>, query parameters, and page sections. Use{' '}
                    <code>*</code> as a wildcard for values that change between pages.
                  </p>
                  <p>
                    Hostnames must be exact. To include subdomains, use a whole-label wildcard such
                    as <code>*.example.com/*</code>; it will not match <code>example.com.evil</code>
                    .
                  </p>
                  <RuleHelpExample
                    pattern="app.example.com/projects/*"
                    urls={['app.example.com/projects/42', 'app.example.com/projects/99?view=board']}
                  />
                </section>

                <div className="dedupe-rule-help-comparison-heading">
                  <span className="dedupe-rule-help-step-label">Step 2 · Comparison method</span>
                  <strong>Choose how included URLs are compared</strong>
                  <p>Each method below produces a comparison result used to find duplicates.</p>
                </div>

                <section>
                  <h5>Ignore query and page section</h5>
                  <p>
                    Compares the complete page path. Anything beginning with <code>?</code> or{' '}
                    <code>#</code> is ignored, but a different path remains a different page.
                  </p>
                  <RuleHelpExample
                    comparisonResult="app.example.com/projects/42"
                    urls={[
                      'app.example.com/projects/42?view=board#notes',
                      'app.example.com/projects/42?view=list',
                    ]}
                  />
                </section>

                <section>
                  <h5>Stop after the item ID</h5>
                  <p>
                    The last <code>*</code> in the pattern marks the item ID. Later path parts,
                    query parameters, and page sections are ignored.
                  </p>
                  <RuleHelpExample
                    comparisonResult="app.example.com/workspaces/acme/items/42"
                    pattern="app.example.com/workspaces/*/items/*"
                    urls={[
                      'app.example.com/workspaces/acme/items/42/edit?tab=overview',
                      'app.example.com/workspaces/acme/items/42/history#latest',
                    ]}
                  />
                </section>

                <section>
                  <h5>One tab per site</h5>
                  <p>
                    Ignores the entire path. Every URL matched on the same hostname is treated as
                    the same page.
                  </p>
                  <RuleHelpExample
                    comparisonResult="app.example.com"
                    urls={['app.example.com/projects/42', 'app.example.com/inbox']}
                  />
                  <div className="dedupe-rule-help-warning">
                    <AlertTriangle aria-hidden="true" size={15} />
                    <span>
                      High impact: every included URL on the same hostname is treated as a
                      duplicate.
                    </span>
                  </div>
                </section>

                <section>
                  <h5>Order and safety</h5>
                  <p>
                    Google and Notion presets run first. Custom rules run top to bottom, and the
                    first match decides. Unmatched tabs require an exact full-URL match.
                  </p>
                  <p>
                    Use <strong>Preview matches</strong> before saving to see which tab Weaver will
                    keep and which copies it would close.
                  </p>
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
