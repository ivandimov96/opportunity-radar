"use client";
/**
 * A submit button that asks first, in the app's own dialog: every confirmation
 * in the product looks and behaves the same. The message is written as a
 * question followed by what will happen ("Remove Acme? Its research is
 * deleted ..."): the question becomes the title, the rest the explanation.
 * Confirming submits the form the button belongs to; Escape, the backdrop and
 * Cancel all close it without doing anything.
 */
import { useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./icons";

export function ConfirmButton({ message, heading: givenHeading, confirmLabel, danger, children, className = "", ...rest }: { message: string; /** Overrides the title taken from the message (the button's own `title` stays a tooltip). */ heading?: string; confirmLabel?: ReactNode; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const cut = message.indexOf("?");
  const heading = givenHeading ?? (cut > 0 ? message.slice(0, cut + 1) : "Are you sure?");
  const detail = givenHeading ? message : cut > 0 ? message.slice(cut + 1).trim() : message;
  const destructive = danger ?? /btn-danger|hover:text-bad/.test(className);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        ref={trigger}
        type="submit"
        className={className}
        {...rest}
        onClick={(e) => {
          e.preventDefault();
          dialog.current?.showModal();
        }}
      >
        {children}
      </button>
      <dialog ref={dialog} className="modal" aria-labelledby={`${id}-title`} aria-describedby={detail ? `${id}-detail` : undefined} onClick={(e) => e.target === dialog.current && close()}>
        <div className="modal-body">
          <span className={`modal-icon ${destructive ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent-text"}`}>
            <Icon name={destructive ? "alert" : "info"} className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-[0.95rem] font-semibold leading-snug text-ink">
              {heading}
            </h2>
            {detail && (
              <p id={`${id}-detail`} className="text-[0.8125rem] text-ink-muted mt-1.5 leading-relaxed whitespace-normal">
                {detail}
              </p>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className={`btn ${destructive ? "btn-danger-solid" : "btn-primary"}`}
            onClick={() => {
              close();
              // Submit the surrounding form as if the original button had been pressed.
              trigger.current?.form?.requestSubmit(trigger.current);
            }}
          >
            {confirmLabel ?? (destructive ? "Yes, do it" : "Confirm")}
          </button>
        </div>
      </dialog>
    </>
  );
}
