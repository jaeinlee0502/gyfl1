// 실제 API 응답이 아닌 자동화용 가상 검토 의견.
export function reviewFixture() {
  return {
    document:{readability:'clear',detectedQuestionCount:2,notes:[]},
    questions:[{
      id:'1',kind:'choice',pages:[1],stemExcerpt:'빈칸 (가), (나)에 들어갈 숫자를 순서대로 고르시오.',
      answerStatus:'uncertain',answers:[],rationale:'(나)에 해당하는 자료가 없어 두 수의 순서를 확정할 수 없습니다.',confidence:'medium',
      issues:[{category:'missing_label',severity:'candidate',description:'발문은 (가), (나)를 요구하지만 자료에는 (가)만 있습니다.',page:1,
        quote:'사과 (가)개이다.',location:'1번 자료 상자',suggestion:'의도한 (나) 자료를 제시하거나 발문과 선지를 수정하세요.'}],uncertainties:[],
    },{
      id:'2',kind:'choice',pages:[2],stemExcerpt:'2 + 3의 값은?',answerStatus:'single',answers:['②'],
      rationale:'2 + 3 = 5이므로 ②입니다.',confidence:'high',issues:[],uncertainties:[],
    }],
  };
}
export const apiFixture = value => ({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
export const modelsFixture={models:[{name:'models/gemini-test-flash',displayName:'Gemini Test Flash (모의 응답)',supportedGenerationMethods:['generateContent'],outputTokenLimit:8192}]};
