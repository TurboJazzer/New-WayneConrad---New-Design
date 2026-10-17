(function(){function name(el){if(el.type==='hidden'||el.type==='submit'||el.type==='button')return;if(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||(el.labels&&el.labels.length))return;var t=el.getAttribute('placeholder')||'';if(!t){var p=el.closest('.field,.fg,.form-group,div');var l=p&&p.querySelector('label,.label,h3,h4');t=l?l.textContent.trim():''}if(!t)t=el.name||el.id||'';if(t)el.setAttribute('aria-label',t.replace(/^e\.g\.\s*/i,'Example: ').slice(0,80))}
function run(){document.querySelectorAll('input,select,textarea').forEach(name)}
if(document.readyState!=='loading')run();else document.addEventListener('DOMContentLoaded',run);
new MutationObserver(run).observe(document.documentElement,{childList:true,subtree:true})})();
