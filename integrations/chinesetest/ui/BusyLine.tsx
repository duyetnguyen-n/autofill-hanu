import React from "react";
import { Spinner } from "@fluentui/react-components";
export function BusyLine({children}:{children:React.ReactNode}) {
  return <div className="ct-busy-line" role="status" aria-live="polite"><Spinner size="extra-tiny"/><span>{children}</span></div>;
}
