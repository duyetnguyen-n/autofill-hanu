import {normalize} from './shared';

// A form owner can replace Google's default acknowledgement. Require a
// positive acknowledgement on a response-only document, never instructional
// wording inside a question, a closed form, or a CAPTCHA/error page.
export function hasSubmissionConfirmation(input:{text:string;hasQuestions:boolean;hasNavigation:boolean;blocked:boolean}):boolean {
  if(input.hasQuestions||input.hasNavigation||input.blocked)return false;
  const text=normalize(input.text);
  return /(?:your )?response has been recorded|da ghi lai cau tra loi|cau tra loi cua ban da duoc ghi lai|chuc mung thi sinh da hoan thanh buoc dien thong tin dang ky bieu mau|恭喜您完成填写报名信息/.test(text);
}
