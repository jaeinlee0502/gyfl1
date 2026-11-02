// 레이아웃만 재현한 가상 정보표. 사용자 파일의 문항/점수/정답/개인정보를 사용하지 않는다.
export function tablePages() {
  const item=(str,x,y,width=20)=>({str:String(str),x,y,width,height:10});
  const first={page:1,width:595,height:842,rotation:0,items:[
    item('총 문항수 7 문항',45,60,150),item('총점 100점 선택형 70점 서답형 30점',45,80,400),item('선택형 문항',255,100,70),
    item('문항번호',50,125,40),item('배점',490,125,20),item('정답',535,125,20),item('1',285,798,5),item('/',305,798,5),item('2',325,798,5)]};
  const second={page:2,width:595,height:842,rotation:0,items:[item('서답형 문항',255,180,70),
    item('총합계',240,318,30),item('100',493,318,15),item('비율(%)',240,340,45),item('100',493,340,15),
    item('2',285,798,5),item('/',305,798,5),item('2',325,798,5)]};
  const choice=(page,n,y)=>page.items.push(item(n,67,y,5),item('가상 내용',120,y,100),item('14',495,y,10),item(n,542,y,5));
  for(const n of [1,2,3]) choice(first,n,165+(n-1)*52);
  choice(second,4,80);choice(second,5,132);
  for(const [n,y] of [[1,212],[2,268]]) {
    second.items.push(item(n,67,y,5),item('가상 서답 영역',120,y,100),item('15',495,y,10));
    for(const [offset,text] of [[-21,'서답형'],[-7,'채점 기'],[7,'준표 참'],[21,'조']]) second.items.push(item(text,530,y+offset,30));
  }
  return [first,second];
}
