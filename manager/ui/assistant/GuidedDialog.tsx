import { forwardRef } from "react";
import { Dialog as FluentDialog, DialogSurface as FluentSurface, type DialogProps, type DialogSurfaceProps } from "@fluentui/react-components";
import { useGuide } from "./guide";

export function GuidedDialog(props: DialogProps) {
  const { walkthrough } = useGuide();
  return <FluentDialog {...props} modalType={walkthrough ? "non-modal" : props.modalType}/>;
}

export const GuidedDialogSurface = forwardRef<HTMLDivElement, DialogSurfaceProps>(function GuidedDialogSurface(props, ref) {
  const { walkthrough } = useGuide();
  const className = [props.className, walkthrough && "walk-dialog"].filter(Boolean).join(" ");
  return <FluentSurface {...props} ref={ref} className={className}/>;
});
