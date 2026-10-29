# -*- coding: utf-8 -*-
"""Встраивает серверный мост в HTML-тест."""

_FORCE_START_JS = (
    "window.__lisResetStarted=function(){started=false;locked=false;};"
    "window.__lisForceStart=function(mins){"
    "if(locked)return false;"
    "var m=Math.round(Number(mins));"
    "if(!Number.isFinite(m)||m<1)return false;"
    "started=true;locked=false;"
    "testBody.classList.add('show');"
    "var sr=document.getElementById('startrow');if(sr)sr.classList.add('done');"
    "var st=document.getElementById('start');if(st){st.classList.add('done');st.disabled=true;}"
    "var hd=document.getElementById('head');if(hd)hd.classList.add('started');"
    "['num','call','mins'].forEach(function(id){var el=document.getElementById(id);if(el)el.disabled=true;});"
    "var mi=document.getElementById('mins');if(mi)mi.value=String(m);"
    "if(typeof saveBtn!=='undefined'&&saveBtn)saveBtn.disabled=false;"
    "startCountdown(m);"
    "window.scrollTo({top:testBody.offsetTop-12,behavior:'smooth'});"
    "return true;"
    "};"
)

BRIDGE_SNIPPET = """
<script>
window.LIS_SERVER = {
  testId: %TEST_ID%,
  apiBase: "",
  bridgeVersion: %BRIDGE_VERSION_JS%
};
</script>
<script src="/static/test-bridge.js?v=%BRIDGE_VERSION%"></script>
"""


def inject_bridge(html: str, test_id: str, *, static_dir: str = "") -> str:
    import os
    import re

    from . import static_version

    if not static_dir:
        static_dir = os.path.join(os.path.dirname(__file__), "static")
    bridge_ver = static_version.bridge_version(static_dir)
    snippet = (
        BRIDGE_SNIPPET.replace("%TEST_ID%", json_dumps(test_id))
        .replace("%BRIDGE_VERSION_JS%", json_dumps(bridge_ver))
        .replace("%BRIDGE_VERSION%", bridge_ver)
    )
    # убрать прошлую инъекцию при повторной загрузке
    html = _strip_old(html)
    html = patch_no_auto_pdf(html)
    html = patch_timeout_and_results(html)
    # сделать банк вопросов доступным мосту (const QUESTIONS не попадает в window)
    if "window.QUESTIONS = QUESTIONS" not in html:
        html = re.sub(
            r"(const\s+QUESTIONS\s*=\s*buildTest\s*\(\s*\)\s*;)",
            r"\1 window.QUESTIONS = QUESTIONS;",
            html,
            count=1,
        )
    # хуки старта для bridge (сброс started + принудительный старт)
    if "window.__lisForceStart" not in html:
        if "window.__lisResetStarted=function(){started=false;locked=false;};" in html:
            html = html.replace(
                "window.__lisResetStarted=function(){started=false;locked=false;};",
                _FORCE_START_JS,
                1,
            )
        else:
            html = re.sub(
                r"(let\s+started\s*=\s*false\s*;)",
                r"\1 " + _FORCE_START_JS,
                html,
                count=1,
            )
    if "</body>" in html.lower():
        idx = html.lower().rfind("</body>")
        return html[:idx] + snippet + html[idx:]
    return html + snippet


def patch_timeout_and_results(html: str) -> str:
    """Таймер: без принудительной двойки; в результатах — блок «не успел ответить»."""
    import re

    html = re.sub(
        r"finishTest\(\s*\{\s*forceGrade\s*:\s*[\"']?2[\"']?\s*,\s*allowIncomplete\s*:\s*true\s*\}\s*\)",
        "finishTest({ allowIncomplete: true })",
        html,
    )
    html = html.replace(
        'percent + "% верных ответов" + (forceGrade != null ? " · время вышло" : "")',
        'percent + "% верных ответов" + ((timedOut || forceGrade != null) ? " · время вышло" : "")',
    )
    html = html.replace(
        'msg.textContent = forceGrade != null ? "Время вышло. Оценка: " + grade : "";',
        'msg.textContent = (timedOut || forceGrade != null) ? "Время вышло. Оценка: " + grade : "";',
    )

    build_blocks = r'''
function qWord(n){
  const num = Math.abs(Number(n) || 0);
  const n100 = num % 100, n10 = num % 10;
  if (n100 > 10 && n100 < 20) return "вопросов";
  if (n10 === 1) return "вопрос";
  if (n10 >= 2 && n10 <= 4) return "вопроса";
  return "вопросов";
}

function buildBlocks(r){
  const blocks = [];
  const head = document.createElement("div");
  head.className = "pdf-block head";
  head.innerHTML =
    '<div class="pt0">Промежуточная аттестация по модулю</div>' +
    '<div class="ps">' + esc(FULL_TITLE) + '</div>' +
    '<div class="grid">' +
      '<div class="cell"><div class="cl">Номер</div><div class="cv">' + esc(r.num) + '</div></div>' +
      '<div class="cell"><div class="cl">Позывной</div><div class="cv">' + esc(r.call) + '</div></div>' +
      '<div class="cell"><div class="cl">Дата и время</div><div class="cv">' + esc(r.date) + '</div></div>' +
    '</div>' +
    (AUDIENCE ? '<div class="grid"><div class="cell"><div class="cl">Тест предназначен для</div><div class="cv">' + esc(AUDIENCE) + '</div></div></div>' : '') +
    '<div class="grid">' +
      '<div class="cell"><div class="cl">Верных ответов</div><div class="big">' + r.score + ' / ' + QUESTIONS.length + '</div><div class="cv">' + r.percent + '%</div></div>' +
      '<div class="cell"><div class="cl">Оценка</div><div class="big">' + esc(r.grade) + '</div></div>' +
    '</div>';
  blocks.push(head);

  const wrongIdx = [];
  let unansweredN = 0;
  QUESTIONS.forEach((item, i) => {
    const pick = selected(i);
    if (pick === null) unansweredN++;
    else if (pick !== item.correct) wrongIdx.push(i);
  });

  const wrongHead = document.createElement("div");
  wrongHead.className = "pdf-block head";
  wrongHead.innerHTML =
    '<div class="pt0">Неправильные ответы</div>' +
    '<div class="ps">' + (wrongIdx.length ? wrongIdx.length : "нет") + '</div>';
  blocks.push(wrongHead);

  wrongIdx.forEach(i => {
    const item = QUESTIONS[i];
    const pick = selected(i);
    const b = document.createElement("div");
    b.className = "pdf-block bad";
    b.innerHTML =
      '<div class="ph"><span class="pn">Вопрос ' + pad(i) + '</span><span class="pt">Неверно</span></div>' +
      '<p class="pq">' + esc(item.q) + '</p>' +
      item.a.map((txt, j) =>
        '<div class="po' + (pick === j+1 ? " sel" : "") + '"><span class="pb"></span><span>' + esc(txt) + '</span></div>'
      ).join("");
    blocks.push(b);
  });

  if (unansweredN > 0) {
    const u = document.createElement("div");
    u.className = "pdf-block head";
    u.innerHTML =
      '<div class="pt0">Не успел ответить</div>' +
      '<div class="big">' + unansweredN + '</div>' +
      '<div class="cv">' + qWord(unansweredN) + '</div>';
    blocks.push(u);
  }

  return blocks;
}
'''
    if "function buildBlocks" in html:
        html = re.sub(
            r"(?:function qWord\s*\(\s*n\s*\)\s*\{[\s\S]*?\}\s*)?function buildBlocks\s*\(\s*r\s*\)\s*\{[\s\S]*?(?=\n(?:async )?function )",
            lambda _m: build_blocks.strip() + "\n\n",
            html,
            count=1,
        )
    return html


def patch_no_auto_pdf(html: str) -> str:
    """Убрать автоскачивание PDF после «Сохранить», показать HTML-результаты."""
    import re

    # авто-PDF после finishTest
    html = re.sub(
        r"startPdf\(\)\s*"
        r"\.then\(\(\)\s*=>\s*getPdf\(\)\)\s*"
        r"\.then\(f\s*=>\s*\{\s*downloadFile\(f\);\s*say\(\"PDF сохранён на устройстве\.\",\s*true\);\s*\}\)\s*"
        r"\.catch\(\(\)\s*=>\s*say\(\"Не удалось создать PDF\.\"\)\);",
        "if (typeof showHtmlResults === 'function') showHtmlResults(); "
        "else if (typeof say === 'function') say('Результаты на экране.', true);",
        html,
        count=1,
    )
    # текст кнопки после сохранения
    html = html.replace(
        'saveBtn.textContent = "Результат сохранён";',
        'saveBtn.textContent = "Готово";',
    )
    # кнопка PDF — только вручную
    html = html.replace(
        ">Скачать PDF</button>",
        ">Скачать PDF (по желанию)</button>",
    )

    helper = r"""
function showHtmlResults(){
  try {
    const r = resultData();
    let box = document.getElementById("htmlResults");
    if (!box) {
      box = document.createElement("div");
      box.id = "htmlResults";
      const wrap = document.querySelector(".wrap") || document.body;
      wrap.appendChild(box);
    }
    function makeBackBtn(id) {
      const b = document.createElement("button");
      b.id = id;
      b.type = "button";
      b.className = "lis-back-to-gate";
      b.textContent = "Вернуться к тестированию";
      b.onclick = function () {
        if (typeof window.__lisReturnToGate === "function") window.__lisReturnToGate();
        else location.reload();
      };
      return b;
    }
    box.innerHTML = "";
    box.appendChild(makeBackBtn("lisBackToGateTop"));
    const title = document.createElement("h2");
    title.className = "lis-results-title";
    title.textContent = "Результаты тестирования";
    box.appendChild(title);
    const blocks = (typeof buildBlocks === "function") ? buildBlocks(r) : [];
    blocks.forEach(b => box.appendChild(b));
    box.appendChild(makeBackBtn("lisBackToGate"));
    if (typeof window.__lisMarkFinished === "function") window.__lisMarkFinished();
    try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e1) {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    console.error(e);
    if (typeof window.__lisMarkFinished === "function") window.__lisMarkFinished();
  }
}
"""
    if "function showHtmlResults" in html:
        # callable: иначе re.sub съедает \n внутри helper (ломая .join("\n"))
        html = re.sub(
            r"function showHtmlResults\s*\(\s*\)\s*\{[\s\S]*?(?=\nfunction startPdf)",
            lambda _m: helper.strip() + "\n",
            html,
            count=1,
        )
    elif "function buildBlocks" in html:
        html = html.replace(
            "function startPdf(){",
            helper + "\nfunction startPdf(){",
            1,
        )

    # убрать прошлые стили результатов и вставить актуальные
    html = re.sub(
        r"#htmlResults\{[^}]*\}(?:\s*#htmlResults[^\{]*\{[^}]*\})*"
        r"(?:\s*#result\.show\{[^}]*\})?",
        "",
        html,
        count=1,
    )
    html = re.sub(
        r"html\.lis-finished #htmlResults[\s\S]*?pointer-events:none!important\}",
        "",
        html,
        count=1,
    )
    # убрать старые стили кнопки возврата
    html = re.sub(
        r"#lisBackToGate(?:Top)?\{[^}]*\}",
        "",
        html,
    )
    html = re.sub(
        r"\.lis-back-to-gate\{[^}]*\}",
        "",
        html,
    )
    css = (
        "#htmlResults{display:none;margin:18px auto;padding:8px 0 32px;max-width:900px;"
        "width:100%;box-sizing:border-box;gap:12px}"
        "html.lis-finished #htmlResults,body.lis-finished #htmlResults{display:grid!important}"
        "#htmlResults .pdf-block{width:100%!important;max-width:100%;box-sizing:border-box}"
        "#htmlResults .lis-results-title{margin:8px 0;color:#19f0f0;font-weight:normal;"
        "text-transform:uppercase;letter-spacing:.08em;font-size:18px;text-align:center}"
        ".lis-back-to-gate,#lisBackToGate,#lisBackToGateTop{"
        "margin:12px auto;padding:14px 18px;width:100%;max-width:420px;"
        "justify-self:center;display:block;text-align:center;"
        "font:inherit;text-transform:uppercase;letter-spacing:.08em;"
        "cursor:pointer;background:#19f0f0;color:#001014;border:0}"
        "#lisBackToGateTop{margin:0 auto 16px}"
        "html.lis-finished #head,body.lis-finished #head,"
        "html.lis-finished #testbody,body.lis-finished #testbody,"
        "html.lis-finished #testbody.show,body.lis-finished #testbody.show,"
        "html.lis-finished #pdfroot,body.lis-finished #pdfroot{display:none!important;"
        "visibility:hidden!important;pointer-events:none!important}"
        "html.lis-finished .lis-nav,body.lis-finished .lis-nav{display:none!important}"
    )
    if ".lis-back-to-gate{" not in html and "</style>" in html:
        html = html.replace("</style>", css + "\n</style>", 1)

    return html


def _strip_old(html: str) -> str:
    import re
    html = re.sub(
        r"<script>\s*window\.LIS_SERVER\s*=\s*\{[\s\S]*?\}\s*;\s*</script>\s*",
        "",
        html,
        count=1,
    )
    html = re.sub(
        r'<script[^>]+src="/static/test-bridge\.js[^"]*"[^>]*>\s*</script>\s*',
        "",
        html,
        count=1,
    )
    return html


def json_dumps(s: str) -> str:
    import json
    return json.dumps(s, ensure_ascii=False)
