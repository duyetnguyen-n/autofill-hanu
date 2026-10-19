import {expect,it} from 'vitest';
import {hasSubmissionConfirmation} from '../src/submission-confirmation';
import {classifyPage} from '../src/recovery';
const page={hasQuestions:false,hasNavigation:false,blocked:false};
it.each(['Your response has been recorded','Câu trả lời của bạn đã được ghi lại','Chúc mừng thí sinh đã hoàn thành bước điền thông tin đăng ký biểu mẫu! Thí sinh vui lòng chờ email xác nhận của Điểm thi.','恭喜您完成填写报名信息！请耐心等待考点确认邮件。'])('recognizes a response-only acknowledgement: %s',text=>{
  expect(hasSubmissionConfirmation({...page,text})).toBe(true);
});
it('does not treat question instructions, CAPTCHA, server errors, or closure as successful submission',()=>{
  const text='Chúc mừng thí sinh đã hoàn thành bước điền thông tin đăng ký biểu mẫu!';
  for(const change of [{hasQuestions:true},{hasNavigation:true},{blocked:true}])expect(hasSubmissionConfirmation({...page,text,...change})).toBe(false);
  for(const text of ['Thank you','500. Internal Server Error','Biểu mẫu không còn chấp nhận phản hồi.','Your response has NOT been recorded'])expect(hasSubmissionConfirmation({...page,text})).toBe(false);
  expect(classifyPage({text:'Biểu mẫu HSK4 không còn chấp nhận phản hồi.',hasQuestions:false,hasNavigation:false,captcha:false,online:true})).toMatchObject({issue:{reason:'form_closed'}});
});
