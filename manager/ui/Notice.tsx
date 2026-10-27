import React from 'react';
import {Button,MessageBar,MessageBarActions,MessageBarBody} from '@fluentui/react-components';
import {DismissRegular} from '@fluentui/react-icons';
import './notice.css';

/** One presentation for transient feedback and contextual operational alerts. */
export function Notice({intent='info',children,onDismiss,actions,className=''}:{intent?:'info'|'success'|'warning'|'error';children:React.ReactNode;onDismiss?:()=>void;actions?:React.ReactNode;className?:string}){
  return <MessageBar intent={intent} layout="multiline" className={`app-notice ${className}`} role={intent==='error'?'alert':'status'}>
    <MessageBarBody>{children}</MessageBarBody>
    {(actions||onDismiss)&&<MessageBarActions containerAction={onDismiss?<Button appearance="transparent" icon={<DismissRegular/>} aria-label="Đóng thông báo" onClick={onDismiss}/>:undefined}>{actions}</MessageBarActions>}
  </MessageBar>;
}
