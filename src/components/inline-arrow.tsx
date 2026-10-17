import { ArrowRight } from "lucide-react";

/** The arrow inside a label such as "Images → video": a drawn icon for sight, and the word "to" for assistive tech. */
export function ToArrow() {
  return (
    <>
      <ArrowRight className="fn-inline-arrow" size={14} aria-hidden="true" />
      <span className="sr-only"> to </span>
    </>
  );
}
