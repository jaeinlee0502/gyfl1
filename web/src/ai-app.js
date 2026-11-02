import { createPdfTask } from './pdf.js';
import { LIMITS, listModels, generateReview, reconcileReviews, compareReference, questionStatus, detectMime, toBase64 } from './gemini.js';
import { aiReportBuffer } from './ai-report.js';
import { download } from './report.js';

const $=id=>document.getElementById(id);
const element=(tag,text,className)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(className)e.className=className;return e;};
const answerStates={single:'단일 답',multiple:'복수 답 후보',none:'정답 없음 후보',uncertain:'답 확정 어려움',unreadable:'판독 불가'};
const confidenceLabels={high:'높음',medium:'보통',low:'낮음'};

export function initAi() {
  let file=null,reference=null,models=[],result=null,loadingFile=false,loadingInfo=false,infoError=false,running=false,listing=false;
  let revision=0,operation=0,fileSerial=0,infoSerial=0,active=null,elapsedTimer;
  let pdfTask=null,pdf=null,bitmap=null,page=1,renderTask=null,renderSerial=0;
  const message=(text,error=false)=>{$('ai-message').textContent=text;$('ai-message').classList.toggle('error',error);};
  const resetResult=()=>{revision++;result=null;$('ai-results').hidden=true;$('ai-cards').replaceChildren();$('ai-consent').checked=false;};
  const busy=()=>running||listing;
  function update() {
    const b=busy();
    for(const id of ['ai-key','ai-models','ai-model','ai-file','ai-info','ai-subject','ai-grade','ai-count','ai-consent','ai-info-clear']) $(id).disabled=b;
    $('ai-models').disabled=b||!$('ai-key').value.trim();
    $('ai-model').disabled=b||!models.length;
    $('ai-run').disabled=b||loadingFile||loadingInfo||infoError||!file||!$('ai-key').value.trim()||!$('ai-model').value||!$('ai-consent').checked;
    $('ai-cancel').hidden=!b;
    $('ai-dropzone').setAttribute('aria-busy',String(b||loadingFile));
    $('ai-info-dropzone').setAttribute('aria-busy',String(b||loadingInfo));
    $('ai-export').disabled=b||!result;
  }
  function cancel(text='검토를 중단했습니다. 이미 Google이 받은 요청의 처리·과금 취소를 보장하지 않습니다.') {
    operation++;active?.abort();active=null;running=false;listing=false;clearInterval(elapsedTimer);update();message(text);
  }
  for (const mode of ['ai','compare']) $('mode-'+mode).addEventListener('click',()=>{
    for(const m of ['ai','compare']) {
      $(m+'-mode').hidden=m!==mode;$('mode-'+m).classList.toggle('active',m===mode);$('mode-'+m).setAttribute('aria-selected',String(m===mode));
    }
  });
  function clearModels() {
    models=[];$('ai-model').replaceChildren(new Option('키 입력 후 목록을 불러오세요',''));
  }
  $('ai-key').addEventListener('input',()=>{clearModels();resetResult();update();message('키를 변경했습니다. 사용 가능한 모델을 다시 불러오세요.');});
  $('ai-forget').addEventListener('click',()=>{cancel('API 키를 이 탭에서 지웠습니다.');$('ai-key').value='';clearModels();$('ai-consent').checked=false;update();});
  $('ai-models').addEventListener('click',async()=>{
    if(busy())return;
    const token=++operation;active=new AbortController();listing=true;update();message('Google에서 이 키로 사용할 수 있는 모델 목록을 조회합니다. 문서는 보내지 않습니다…');
    try {
      const found=await listModels($('ai-key').value,{signal:active.signal});
      if(token!==operation)return;
      models=found;$('ai-model').replaceChildren(new Option('검토 모델을 선택하세요',''));
      for(const m of models)$('ai-model').append(new Option(m.label,m.name));
      message('모델 목록을 불러왔습니다. PDF·이미지 이해가 가능한 모델을 선택하세요. 모델별 요금이 다릅니다.');
    } catch(error){if(token===operation)message(error.message,true);}
    finally{if(token===operation){listing=false;active=null;update();}}
  });
  for(const id of ['ai-model','ai-subject','ai-grade','ai-count']) $(id).addEventListener(id==='ai-subject'||id==='ai-count'?'input':'change',()=>{resetResult();update();});
  $('ai-consent').addEventListener('change',update);
  $('ai-cancel').addEventListener('click',()=>cancel());

  async function destroyPreview() {
    renderSerial++;renderTask?.cancel();
    if(renderTask)await renderTask.promise.catch(()=>{});
    renderTask=null;bitmap?.close();bitmap=null;pdf=null;
    const task=pdfTask;pdfTask=null;if(task)await task.destroy();
    const canvas=$('ai-canvas');canvas.width=1;canvas.height=1;$('ai-preview').hidden=true;
  }
  async function showPage(target) {
    if(!file)return;
    const token=++renderSerial;
    renderTask?.cancel();if(renderTask)await renderTask.promise.catch(()=>{});
    if(token!==renderSerial)return;
    page=Math.max(1,Math.min(file.pages,target));
    $('ai-page-label').textContent=`파일 ${page} / ${file.pages}쪽`;$('ai-prev').disabled=page===1;$('ai-next').disabled=page===file.pages;
    const canvas=$('ai-canvas'),ctx=canvas.getContext('2d');
    try {
      if(pdf) {
        const p=await pdf.getPage(page);if(token!==renderSerial)return;
        const base=p.getViewport({scale:1});const scale=Math.min(1.5,1200/base.width,1800/base.height);
        const viewport=p.getViewport({scale});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        renderTask=p.render({canvasContext:ctx,viewport});await renderTask.promise;if(token===renderSerial)renderTask=null;
      } else if(bitmap) {
        const scale=Math.min(1,1200/bitmap.width,1800/bitmap.height);canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      }
    } catch(error){if(token===renderSerial && error.name!=='RenderingCancelledException')message('이 쪽의 미리보기를 그리지 못했습니다. 원본을 확인하고 PDF로 다시 저장해 주세요.',true);}
  }
  $('ai-prev').addEventListener('click',()=>showPage(page-1));$('ai-next').addEventListener('click',()=>showPage(page+1));
  async function chooseFile(candidates) {
    if(busy()||loadingFile){message('파일 처리 중에는 원안지를 바꿀 수 없습니다.',true);return;}
    const selected=Array.from(candidates||[]);
    if(selected.length!==1){message('AI 검토 원안지는 파일 한 개씩 선택해 주세요.',true);return;}
    const f=selected[0],token=++fileSerial;resetResult();file=null;loadingFile=true;update();
    $('ai-file-name').textContent=f.name;message('파일을 PC 안에서 읽고 미리보기를 준비합니다. 아직 전송하지 않습니다…');
    try {
      if(!f.size||f.size>LIMITS.bytes)throw new Error('AI 검토 원안지는 10MB 이하의 비어 있지 않은 파일이어야 합니다.');
      const bytes=new Uint8Array(await f.arrayBuffer()),mime=detectMime(bytes,f.name);
      if(token!==fileSerial)return;
      await destroyPreview();if(token!==fileSerial)return;
      let pages=1;
      if(mime==='application/pdf') {
        const task=createPdfTask(bytes.slice().buffer,{preview:true});pdfTask=task;
        const source=await task.promise;
        if(token!==fileSerial){await task.destroy();return;}pdf=source;
        pages=pdf.numPages;
        if(pages>LIMITS.pages)throw new Error('AI 검토 PDF는 30쪽 이하로 나누어 주세요.');
      } else {
        const image=await createImageBitmap(new Blob([bytes],{type:mime}));
        if(token!==fileSerial){image.close();return;}bitmap=image;
        if(bitmap.width*bitmap.height>LIMITS.pixels)throw new Error('이미지는 4,000만 화소 이하로 줄여 주세요.');
      }
      if(token!==fileSerial)return;
      file={name:f.name,bytes,mime,pages};$('ai-preview').hidden=false;$('ai-preview').open=true;
      await showPage(1);if(token!==fileSerial)return;
      message('원안지를 준비했습니다. 미리보기와 문항 수를 확인하고 전송 동의 후 검토를 시작하세요.');
    } catch(error) {
      if(token!==fileSerial)return;
      file=null;await destroyPreview();
      message(error.name==='PasswordException'?'암호화된 PDF는 지원하지 않습니다. 권한 있는 복사본의 암호를 해제하세요.':/AI 검토|HWP|화소/.test(error.message)?error.message:'파일을 읽지 못했습니다. 손상 여부를 확인하고 PDF·이미지로 다시 저장하세요.',true);
    } finally {if(token===fileSerial){loadingFile=false;update();}}
  }
  function extractReference(f,signal) {
    return new Promise((resolve,reject)=>{
      const workerUrl=new URL('./worker.js',import.meta.url);workerUrl.searchParams.set('v',__APP_VERSION__);
      const worker=new Worker(workerUrl,{type:'module'});
      let settled=false;
      const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);worker.terminate();error?reject(error):resolve(value);};
      const stop=()=>done(new DOMException('취소됨','AbortError'));
      const timer=setTimeout(()=>done(new Error('문항정보표 처리 시간이 초과되었습니다. 표를 나누어 주세요.')),45000);
      signal.addEventListener('abort',stop,{once:true});
      worker.onerror=()=>done(new Error('문항정보표 처리 도구를 실행하지 못했습니다.'));
      worker.onmessage=async({data})=>{
        if(data.kind==='ready') {
          try{const buffer=await f.arrayBuffer();if(!settled)worker.postMessage({kind:'extract-info',file:{name:f.name,buffer}},[buffer]);}catch{done(new Error('문항정보표를 읽지 못했습니다.'));}
        }
        if(data.kind==='info-result')done(null,data.doc);
        if(data.kind==='error')done(new Error(data.message));
      };
      if(signal.aborted)stop();
    });
  }
  let infoController=null;
  async function chooseInfo(candidates) {
    if(busy())return;
    const selected=Array.from(candidates||[]);
    if(selected.length!==1){message('문항정보표도 파일 한 개씩 선택하세요.',true);return;}
    const f=selected[0];
    if(!/\.(xlsx|docx|hwpx|hwp|pdf)$/i.test(f.name)||!f.size||f.size>50*1024*1024){message('문항정보표는 50MB 이하 XLSX·DOCX·HWP·HWPX·텍스트 PDF를 선택하세요.',true);return;}
    const token=++infoSerial;infoController?.abort();infoController=new AbortController();resetResult();reference=null;infoError=false;loadingInfo=true;update();
    $('ai-info-name').textContent=f.name;$('ai-reference-status').textContent='PC 안에서 정보표를 읽고 있습니다…';
    try{
      const doc=await extractReference(f,infoController.signal);if(token!==infoSerial)return;
      reference=doc;
      $('ai-reference-status').textContent=`${doc.questions.length}행 추출 · ${doc.notes.length?'불확실한 추출이 있어 원문 확인 필요':'추출 값 확인 필요'} · AI에 보내지 않음`;
    }catch(error){if(token===infoSerial){infoError=true;$('ai-reference-status').textContent=error.message;message('정보표를 읽지 못했습니다. 다시 선택하거나 ‘정보표 제외’를 눌러 원안지만 검토하세요.',true);}}
    finally{if(token===infoSerial){loadingInfo=false;infoController=null;update();}}
  }
  function clearInfo(){infoSerial++;infoController?.abort();infoController=null;loadingInfo=false;infoError=false;reference=null;$('ai-info-name').textContent='미선택 · 원안지만으로 AI 검토 가능';$('ai-reference-status').textContent='별도 정보표와 그 정답은 Google로 보내지 않습니다.';resetResult();update();}
  $('ai-info-clear').addEventListener('click',clearInfo);
  for(const [id,choose] of [['ai-file',chooseFile],['ai-info',chooseInfo]])$(id).addEventListener('change',()=>{const selected=Array.from($(id).files);$(id).value='';if(selected.length)choose(selected);});
  function dropzone(id,choose) {
    const zone=$(id);let depth=0;
    for(const type of ['dragenter','dragover'])zone.addEventListener(type,event=>{
      if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
      event.preventDefault();event.stopPropagation();if(type==='dragenter')depth++;
      event.dataTransfer.dropEffect=busy()?'none':'copy';if(!busy())zone.classList.add('drag-active');
    });
    zone.addEventListener('dragleave',event=>{event.stopPropagation();if(--depth<=0){depth=0;zone.classList.remove('drag-active');}});
    zone.addEventListener('drop',event=>{
      event.preventDefault();event.stopPropagation();depth=0;zone.classList.remove('drag-active');
      if(busy()){message('검토 중에는 파일을 바꿀 수 없습니다.',true);return;}
      if(Array.from(event.dataTransfer.items||[]).some(i=>i.webkitGetAsEntry?.()?.isDirectory)){message('폴더는 지원하지 않습니다. 파일 한 개를 놓으세요.',true);return;}
      choose(event.dataTransfer.files);
    });
  }
  dropzone('ai-dropzone',chooseFile);dropzone('ai-info-dropzone',chooseInfo);
  document.addEventListener('drop',event=>{if(!$('ai-mode').hidden)message('AI 원안지 또는 문항정보표 영역에 파일 한 개를 놓아 주세요.',true);});
  $('ai-clear').addEventListener('click',async()=>{
    cancel('선택한 파일과 AI 검토 결과를 지웠습니다. API 키도 지우려면 ‘키 지우기’를 누르세요.');
    fileSerial++;file=null;loadingFile=true;clearInfo();$('ai-file-name').textContent='선택한 파일 없음';
    try{await destroyPreview();}finally{loadingFile=false;update();}
  });

  function field(card,label,value){const p=element('p');p.append(element('strong',label+' '),document.createTextNode(value||'기재 없음'));card.append(p);}
  function render() {
    const r=result;const candidates=r.review.questions.filter(q=>questionStatus(q,reference)==='오류 후보').length;
    $('ai-results').hidden=false;
    $('ai-summary').textContent=`${r.secondComplete?'2단계 응답 수신':'2차 검토 미완료 · 1차 의견'} · ${r.review.questions.length}문항 · 오류 후보 ${candidates}문항\n${r.model} · ${r.at}\n판정·인용·쪽 번호 모두 AI의 검토 의견입니다. 원본과 대조하세요.`;
    const warnings=[r.partialReason,...r.review.warnings,...r.review.document.notes].filter(Boolean);
    if(reference?.notes?.length)warnings.push(`정보표 추출 주의: ${reference.notes.map(n=>n.message).join(' / ')}`);
    $('ai-warning').hidden=!warnings.length;$('ai-warning').textContent=warnings.join('\n');$('ai-cards').replaceChildren();
    for(const q of r.review.questions) {
      const card=element('article',null,'ai-result-card'),head=element('div',null,'ai-card-head'),status=questionStatus(q,reference);
      head.append(element('h3',`${q.canonical||q.id}번`),element('span',status,'badge '+(status==='오류 후보'?'error':status==='확인 필요'?'review':'neutral')));card.append(head);
      field(card,'AI 예상 답:',`${q.answers.join(' / ')||'확정하지 못함'} (${answerStates[q.answerStatus]})`);
      const compared=compareReference(q,reference);field(card,'정보표:',`${compared.answer} · ${compared.label}`);
      field(card,'원문 발췌:',q.stemExcerpt);field(card,'풀이 요약:',q.rationale);field(card,'AI 자체 신뢰도:',confidenceLabels[q.confidence]+' · 객관적으로 측정한 정확도가 아닙니다.');
      if(q.pages.length){const links=element('p');links.append(document.createTextNode('원본 위치: '));for(const p of q.pages){const b=element('button',`파일 ${p}쪽`,'quiet');b.addEventListener('click',()=>{$('ai-preview').hidden=false;$('ai-preview').open=true;showPage(p);$('ai-preview').scrollIntoView({behavior:'smooth',block:'start'});});links.append(b);}card.append(links);}
      for(const i of q.issues){const block=element('div',null,'ai-issue');block.append(element('strong',(i.severity==='candidate'?'오류 후보: ':'확인 필요: ')+i.description));field(block,'근거:',`파일 ${i.page||'?'}쪽 · ${i.location}\n${i.quote}`);field(block,'수정 제안:',i.suggestion);card.append(block);}
      if(q.uncertainties.length)field(card,'불확실성:',q.uncertainties.join('\n'));
      const first=r.first.questions.find(f=>f.canonical===q.canonical);
      if(first){const details=element('details');details.append(element('summary','1차 풀이·검토 기록'));const text=element('pre',`답: ${first.answers.join(' / ')||'확정 어려움'}\n${first.rationale}\n${first.issues.map(i=>`${i.description}\n근거: 파일 ${i.page||'?'}쪽 · ${i.quote}\n${i.suggestion}`).join('\n')}\n${first.uncertainties.join('\n')}`);details.append(text);card.append(details);}
      $('ai-cards').append(card);
    }
    update();
  }
  $('ai-run').addEventListener('click',async()=>{
    if(busy()||!file||!$('ai-consent').checked)return;
    const count=$('ai-count').value,expectedCount=count?Number(count):null;
    if(count&&(!Number.isInteger(expectedCount)||expectedCount<1||expectedCount>LIMITS.questions)){message('문항 수는 1~40의 정수로 입력하거나 비워 두세요.',true);return;}
    const m=models.find(m=>m.name===$('ai-model').value);if(!m||!$('ai-key').value.trim())return;
    const token=++operation,key=$('ai-key').value;
    const args={file:{mime:file.mime,base64:toBase64(file.bytes),pages:file.pages},model:m.name,outputTokenLimit:m.outputTokenLimit,subject:$('ai-subject').value,grade:$('ai-grade').value,expectedCount};
    running=true;active=new AbortController();result=null;$('ai-results').hidden=true;update();
    const started=Date.now();let stage='1/2 · 정답표 없이 문항 풀이 및 오류 후보 검토';
    const progress=()=>message(`${stage} · ${Math.floor((Date.now()-started)/1000)}초 경과 · Google에 선택 원안지를 전송했습니다.`);
    progress();elapsedTimer=setInterval(progress,1000);
    try {
      const options={signal:active.signal};
      const first=await generateReview(key,args,options);if(token!==operation)return;
      let review=first,secondComplete=false,partialReason='';
      if(first.questions.length && first.document.readability!=='unreadable') {
        stage='2/2 · 원문을 다시 읽으며 답·발문·기호·선지 재검토';progress();
        try{const second=await generateReview(key,{...args,first},options);review=reconcileReviews(first,second);secondComplete=true;}
        catch(error){if(token!==operation)return;partialReason=`2차 재검토 미완료: ${error.message} 아래는 1차 검토 의견입니다.`;}
      }else partialReason='문항을 충분히 판독하지 못해 2차 검토를 진행하지 않았습니다.';
      if(token!==operation)return;
      result={name:file.name,at:new Date().toLocaleString('ko-KR'),model:m.name,expectedCount,first,review,secondComplete,partialReason};
      render();message(secondComplete?'AI 검토 의견을 받았습니다. 원문·풀이·불확실성을 직접 확인하세요.':'검토가 일부만 수행되었습니다. 1차 의견과 미완료 사유를 확인하세요.',!secondComplete);
    }catch(error){if(token===operation)message(error.message,true);}
    finally{if(token===operation){clearInterval(elapsedTimer);running=false;active=null;args.file.base64='';update();}}
  });
  $('ai-export').addEventListener('click',async()=>{
    if(!result)return;const current=result,token=revision;$('ai-export').disabled=true;
    try{const bytes=await aiReportBuffer(current,reference);if(token===revision)download(bytes,'시험출제_Gemini_검토의견.xlsx');}
    catch{message('AI 검토 보고서를 만들지 못했습니다. 다운로드 권한을 확인하세요.',true);}
    finally{update();}
  });
  update();
}
