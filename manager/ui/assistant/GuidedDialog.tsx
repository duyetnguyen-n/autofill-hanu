import { forwardRef } from "react";
import { Dialog as FluentDialog, DialogSurface as FluentSurface, type DialogProps, type DialogSurfaceProps } from "@fluentui/react-components";
import { useGuide } from "./guide";
import { useCompanionOpen } from "./companion";

export function GuidedDialog(props: DialogProps) {
  const { walkthrough } = useGuide();
  const companionOpen = useCompanionOpen();
  return <FluentDialog {...props} modalType={walkthrough || companionOpen ? "non-modal" : props.modalType}/>;
}

export const GuidedDialogSurface = forwardRef<HTMLDivElement, DialogSurfaceProps>(function GuidedDialogSurface(props, ref) {
  const { walkthrough } = useGuide();
  const companionOpen = useCompanionOpen();
  const className = [props.className, (walkthrough || companionOpen) && "walk-dialog"].filter(Boolean).join(" ");
  return <FluentSurface {...props} ref={ref} className={className}/>;
});
