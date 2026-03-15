"use strict";

const MAX_TURNS = 6;

const $ = (id) => document.getElementById(id);

const productInputEl = $("productInput");
const originInputEl = $("originInput");
const targetInputEl = $("targetInput");
const submitBtnEl = $("submitBtn");
const resetBtnEl = $("resetBtn");
const statusBarEl = $("statusBar");
const agentStateBarEl = $("agentStateBar");
const agentStateLabelEl = $("agentStateLabel");
const agentStateIconEl = $("agentStateIcon");
const agentStateStepEl = $("agentStateStep");
const clarifyBlockEl = $("clarifyBlock");
const clarifyListEl = $("clarifyList");
const clarifyAnswerEl = $("clarifyAnswerInput");
const resultsAreaEl = $("resultsArea");
const rawJsonBoxEl = $("rawJsonBox");
const thinkingLogEl = $("thinkingLog");
const toolCallsLogEl = $("toolCallsLog");

let isBusy = false;
let agentStep = 1;
let savedInputs = {};
let conversationHistory = [];
let logCounter = 0;

const AGENT_STATES = {
  reviewing: { icon: "🔍", label: "Reviewing inputs", step: "Step 1 of 2" },
  clarifying: { icon: "💬", label: "Asking clarifying questions", step: "Step 1 of 2" },
  generating: { icon: "⚙️", label: "Generating risk report", step: "Step 2 of 2" },
  done: { icon: "✅", label: "Report ready", step: "Complete" }
};

function checkApiKey() {
  return true;
}

function setAgentState(name) {
  const s = AGENT_STATES[name];
  if (!s || !agentStateBarEl) return;
  agentStateBarEl.classList.add("visible");
  if (agentStateLabelEl) agentStateLabelEl.textContent = s.label;
  if (agentStateIconEl) agentStateIconEl.textContent = s.icon;
  if (agentStateStepEl) agentStateStepEl.textContent = s.step;
}

function hideAgentState() {
  if (agentStateBarEl) agentStateBarEl.classList.remove("visible");
}

function setStatus(msg, type, spinning) {
  if (!statusBarEl) return;
  statusBarEl.className = "status " + (type || "");
  if (spinning) {
    statusBarEl.innerHTML =
      '<span class="spinner" aria-hidden="true"></span><span>' + escHtml(msg) + "</span>";
  } else {
    statusBarEl.textContent = msg;
  }
}

function setBusy(busy) {
  isBusy = busy;
  if (submitBtnEl) submitBtnEl.disabled = busy;
  if (productInputEl) productInputEl.disabled = busy;
  if (originInputEl) originInputEl.disabled = busy;
  if (targetInputEl) targetInputEl.disabled = busy;
  document.body.style.cursor = busy ? "progress" : "";
}

function logEntry(icon, label, detail, status) {
  if (!toolCallsLogEl) return null;
  const id = "log-" + (++logCounter);
  const el = document.createElement("div");
  el.className = "tool-call" + (status ? " " + status : "");
  el.id = id;
  el.innerHTML =
    '<span class="tool-icon">' + icon + "</span>" +
    "<div>" +
    '<div class="tool-name">' + escHtml(label) + "</div>" +
    (detail ? '<div class="tool-args">' + escHtml(detail) + "</div>" : "") +
    "</div>";
  toolCallsLogEl.appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (thinkingLogEl) thinkingLogEl.classList.add("visible");
  return id;
}

function updateLogEntry(id, status, resultText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "tool-call " + status;
  const nameEl = el.querySelector(".tool-name");
  if (nameEl) nameEl.className = "tool-name " + status;
  if (resultText) {
    let resEl = el.querySelector(".tool-result-preview");
    if (!resEl) {
      resEl = document.createElement("div");
      resEl.className = "tool-result-preview";
      el.querySelector("div").appendChild(resEl);
    }
    resEl.textContent = "→ " + resultText;
  }
}

function buildReviewPrompt() {
  return (
    "ABSOLUTE RULE — OUTPUT LANGUAGE: Every word of your output MUST be in English. " +
    "Do not use any other language regardless of the user's input language. " +
    "\n\nYou are a Market Entry Risk Assessment Agent. " +
    "Your job is to analyze a product's regulatory and market entry risks when entering a target market from a country of origin. " +
    "\n\nPHASE: Review. Decide if you have enough information to generate the risk report." +
    "\n\nIF critical information is missing: " +
    'Return ONLY this JSON: {"clarification_needed":true,"questions":["Q1 in English?","Q2 in English?","Q3 in English?"]} ' +
    "\n\nIF you have enough information: " +
    'Return ONLY valid JSON in this format: {"scenario_type":"","complexity_level":"Low|Medium|High","regulatory_risks":[],"next_steps":[],"summary":""}'
  );
}

function buildGenerationPrompt() {
  return (
    "ABSOLUTE RULE — OUTPUT LANGUAGE: Every word of your output MUST be in English. " +
    "Do not use any other language regardless of the user's input language. " +
    "\n\nYou are a Market Entry Risk Assessment Agent. " +
    'Return ONLY valid JSON in this format: {"scenario_type":"","complexity_level":"Low|Medium|High","regulatory_risks":[],"next_steps":[],"summary":""}'
  );
}

function getInputs() {
  return {
    product: (productInputEl?.value || "").trim(),
    origin: (originInputEl?.value || "").trim(),
    target: (targetInputEl?.value || "").trim()
  };
}

function validateInputs(inputs) {
  if (!inputs.product) return "Please describe the product.";
  if (!inputs.origin) return "Please enter the country of origin.";
  if (!inputs.target) return "Please enter the target market.";
  return null;
}

function handleSubmit() {
  if (isBusy) return;
  if (!checkApiKey()) return;
  if (agentStep === 1) runStep1();
  else if (agentStep === 2) runStep2();
}

async function runStep1() {
  const inputs = getInputs();
  const validationError = validateInputs(inputs);
  if (validationError) {
    setStatus(validationError, "error");
    return;
  }

  savedInputs = inputs;
  setBusy(true);

  if (toolCallsLogEl) toolCallsLogEl.innerHTML = "";
  if (rawJsonBoxEl) {
    rawJsonBoxEl.textContent = "";
    rawJsonBoxEl.classList.remove("active");
  }
  if (resultsAreaEl) resultsAreaEl.innerHTML = buildWorkingState();

  setAgentState("reviewing");
  setStatus("Reviewing your inputs…", "loading", true);

  const logId = logEntry("🔍", "Reviewing inputs", inputs.product + " · " + inputs.origin + " → " + inputs.target);

  const userPrompt =
    "[IMPORTANT: Respond in English only.]\n\n" +
    "Product: " + inputs.product + "\n" +
    "Country of origin: " + inputs.origin + "\n" +
    "Target market: " + inputs.target + "\n\n" +
    "Assess market entry risks and regulatory requirements. Respond in English only.";

  conversationHistory = [{ role: "user", parts: [{ text: userPrompt }] }];

  try {
    await runAgentLoop(buildReviewPrompt(), "step1");
    if (logId) updateLogEntry(logId, "done", "Inputs reviewed");
  } catch (err) {
    if (logId) updateLogEntry(logId, "error");
    handleError(err);
  } finally {
    setBusy(false);
  }
}

async function runStep2() {
  const answers = (clarifyAnswerEl?.value || "").trim();
  if (!answers) {
    setStatus("Please answer the clarification questions before submitting.", "error");
    if (clarifyAnswerEl) clarifyAnswerEl.focus();
    return;
  }

  setBusy(true);
  setAgentState("generating");
  setStatus("Generating risk report…", "loading", true);

  const logId = logEntry("⚙️", "Generating report", "Processing answers + inputs");

  conversationHistory.push({
    role: "user",
    parts: [{
      text:
        "[IMPORTANT: Respond in English only.]\n\n" +
        "Answers to clarification questions:\n\n" + answers +
        "\n\nNow generate the full Market Entry Risk Report in English only."
    }]
  });

  try {
    await runAgentLoop(buildGenerationPrompt(), "step2");
    if (logId) updateLogEntry(logId, "done", "Report generated");
  } catch (err) {
    if (logId) updateLogEntry(logId, "error");
    handleError(err);
  } finally {
    setBusy(false);
  }
}

async function runAgentLoop(systemInstruction, phase) {
  let turns = 0;
  let retriedOnce = false;

  while (turns < MAX_TURNS) {
    turns++;

    const response = await callGemini(conversationHistory, systemInstruction);
    const candidate = response?.candidates?.[0];

    if (!candidate) throw new Error("Gemini returned no candidate. Check your API key and quota.");

    const parts = candidate.content?.parts || [];
    const textParts = parts.filter(p => p.text);

    conversationHistory.push({ role: "model", parts });

    if (textParts.length > 0) {
      const rawText = textParts.map(p => p.text).join("").trim();
      if (rawJsonBoxEl) rawJsonBoxEl.textContent = rawText || "[empty response]";

      const parsed = parseJsonSafely(rawText);

      if (parsed.clarification_needed === true && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        setAgentState("clarifying");
        showClarificationUI(parsed.questions);
        return;
      }

      if (parsed.scenario_type !== undefined || parsed.regulatory_risks !== undefined) {
        if (phase === "step2" && !retriedOnce && turns === 1) {
          retriedOnce = true;
          conversationHistory.push({
            role: "user",
            parts: [{ text: "Make sure you include all required fields: regulatory_risks, complexity_level, next_steps, and summary. All text must be in English." }]
          });
          setStatus("Refining report…", "loading", true);
          continue;
        }

        setAgentState("done");
        renderReport(parsed);
        setStatus("✓ Market Entry Risk Report ready.", "success");
        if (resetBtnEl) resetBtnEl.style.display = "";
        return;
      }

      if (rawJsonBoxEl) rawJsonBoxEl.classList.add("active");
      setStatus("Unexpected response format. See raw JSON.", "error");
      if (resultsAreaEl) resultsAreaEl.innerHTML = buildErrorState("Unexpected response. See raw JSON.");
      if (resetBtnEl) resetBtnEl.style.display = "";
      return;
    }

    if (candidate.finishReason === "STOP") {
      throw new Error("Agent stopped without producing output. Try rephrasing your inputs.");
    }
    break;
  }

  if (turns >= MAX_TURNS) {
    setStatus("Agent reached maximum turns. Try simplifying your inputs.", "error");
    if (resetBtnEl) resetBtnEl.style.display = "";
  }
}

async function callGemini(contents, systemInstruction) {
  const res = await fetch("/.netlify/functions/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2000
      }
    })
  });

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    throw new Error("Gemini API returned a non-JSON response.");
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || "Gemini API error";
    throw new Error(msg);
  }

  return data;
}

function showClarificationUI(questions) {
  agentStep = 2;

  if (clarifyListEl) {
    clarifyListEl.innerHTML = questions.map(q => "<li>" + escHtml(q) + "</li>").join("");
  }
  if (clarifyBlockEl) clarifyBlockEl.classList.add("visible");

  if (submitBtnEl) submitBtnEl.textContent = "▶ Submit Answers";

  if (productInputEl) productInputEl.disabled = true;
  if (originInputEl) originInputEl.disabled = true;
  if (targetInputEl) targetInputEl.disabled = true;

  if (resetBtnEl) resetBtnEl.style.display = "";
  if (resultsAreaEl) resultsAreaEl.innerHTML = buildClarifyState();

  setStatus("Please answer the questions above, then click Submit Answers.", "loading");
  if (clarifyAnswerEl) clarifyAnswerEl.focus();
}

function renderReport(data) {
  if (!resultsAreaEl) return;

  const complexity = String(data.complexity_level || "").toLowerCase();
  const badgeClass = complexity === "low" ? "low" : complexity === "medium" ? "medium" : "high";
  const scenario = data.scenario_type || "Market Entry Risk Assessment";
  const summary = data.summary || "";

  resultsAreaEl.innerHTML =
    '<div class="result-summary">' +
      '<div>' +
        '<div class="result-summary-title">' + escHtml(scenario) + '</div>' +
        (summary ? '<div class="result-summary-sub">' + escHtml(summary) + '</div>' : "") +
      '</div>' +
      '<span class="badge ' + escHtml(badgeClass) + '">' + escHtml(data.complexity_level || "Unknown") + '</span>' +
    '</div>' +
    '<div class="result-card">' +
      '<h3>Regulatory risks</h3>' +
      renderList(data.regulatory_risks) +
    '</div>' +
    '<div class="result-card">' +
      '<h3>Next steps</h3>' +
      renderList(data.next_steps) +
    '</div>';
}

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="color:var(--muted);font-size:13px;margin:0">No items returned for this section.</p>';
  }
  return "<ul>" + items.map(i => "<li>" + escHtml(String(i)) + "</li>").join("") + "</ul>";
}

function buildWorkingState() {
  return '<div class="empty-state"><div class="empty-state-icon">⚙️</div>Agent is working…</div>';
}

function buildClarifyState() {
  return '<div class="empty-state"><div class="empty-state-icon">💬</div>Answer the questions on the left, then click <strong>Submit Answers</strong>.</div>';
}

function buildErrorState(msg) {
  return '<div class="empty-state" style="color:var(--danger)">' + escHtml(msg) + '</div>';
}

function parseJsonSafely(raw) {
  const t = String(raw || "").trim();

  if (!t) {
    return {
      scenario_type: "Empty response",
      regulatory_risks: [],
      complexity_level: "Unknown",
      next_steps: ["The model returned an empty response."],
      summary: ""
    };
  }

  try { return JSON.parse(t); } catch (_) {}

  const stripped = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(stripped); } catch (_) {}

  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(stripped.slice(first, last + 1)); } catch (_) {}
  }

  console.warn("parseJsonSafely: could not parse response:", raw);
  return {
    scenario_type: "Parse error",
    regulatory_risks: [],
    complexity_level: "Unknown",
    next_steps: [
      "The agent response could not be parsed as valid JSON.",
      "First 300 chars: " + stripped.slice(0, 300)
    ],
    summary: ""
  };
}

function handleError(err) {
  console.error("Agent error:", err);
  hideAgentState();
  setStatus("Error: " + (err.message || "Unknown error — check the browser console."), "error");
  if (resultsAreaEl) {
    resultsAreaEl.innerHTML = buildErrorState("The agent encountered an error. Check your API key, then try again.");
  }
  if (resetBtnEl) resetBtnEl.style.display = "";
}

function resetAll() {
  agentStep = 1;
  savedInputs = {};
  conversationHistory = [];
  isBusy = false;

  if (productInputEl) { productInputEl.value = ""; productInputEl.disabled = false; }
  if (originInputEl) { originInputEl.value = ""; originInputEl.disabled = false; }
  if (targetInputEl) { targetInputEl.value = ""; targetInputEl.disabled = false; }

  if (clarifyAnswerEl) clarifyAnswerEl.value = "";
  if (clarifyListEl) clarifyListEl.innerHTML = "";
  if (clarifyBlockEl) clarifyBlockEl.classList.remove("visible");

  if (submitBtnEl) {
    submitBtnEl.textContent = "▶ Analyze Market Entry";
    submitBtnEl.disabled = false;
  }
  if (resetBtnEl) resetBtnEl.style.display = "none";

  if (toolCallsLogEl) toolCallsLogEl.innerHTML = "";
  if (thinkingLogEl) thinkingLogEl.classList.remove("visible");

  if (rawJsonBoxEl) {
    rawJsonBoxEl.textContent = "";
    rawJsonBoxEl.classList.remove("active");
  }

  if (resultsAreaEl) {
    resultsAreaEl.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">🌍</div>Fill in the form and click Analyze Market Entry.</div>';
  }

  hideAgentState();
  setStatus("", "");
  document.body.style.cursor = "";
  if (productInputEl) productInputEl.focus();
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toggleRawJson() {
  if (rawJsonBoxEl) rawJsonBoxEl.classList.toggle("active");
}

document.addEventListener("DOMContentLoaded", () => {
  checkApiKey();

  if (submitBtnEl) submitBtnEl.addEventListener("click", handleSubmit);
  if (resetBtnEl) resetBtnEl.addEventListener("click", resetAll);

  document.addEventListener("keydown", (e) => {
    const mod = /mac/i.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    if (mod && e.key === "Enter" && !isBusy) {
      e.preventDefault();
      handleSubmit();
    }
  });

  const rawToggleBtn = $("rawJsonToggle");
  if (rawToggleBtn) rawToggleBtn.addEventListener("click", toggleRawJson);

  if (resetBtnEl) resetBtnEl.style.display = "none";
}); am gasit asta... daca vezi este dublat, si asta in ciuda faptului ca in github nu se vede asa totul... abia cand am dat paste in notepad sa ti arat. mai aveam putin si imi venea sa plang... poti sa imi dai script js complet ca sa inlocuiesc tot? nu mai am nervi sa caut cerul prin hartii.  codul o sa ti l mai trimit in alta parte plus cealalata parte. ca sa ai totul complet iata si partea de index html de jos....   </section>
    </div>
  </main>

  <script src="config.js"></script>
  <script src="script.js"></script>

  <script>
    const fileInput = document.getElementById("docUpload");
    const fileMeta = document.getElementById("fileMeta");
    const removeBtn = document.getElementById("removeDocBtn");

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) {
        fileMeta.textContent = "No file selected";
        return;
      }
      fileMeta.textContent = `${file.name} • ${Math.round(file.size / 1024)} KB • ${file.type || "unknown type"}`;
    });

    removeBtn.addEventListener("click", () => {
      fileInput.value = "";
      fileMeta.textContent = "No file selected";
    });
  </script>
</body>
</html>
