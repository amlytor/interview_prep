import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { testConnection, fetchProviderModels, GradingError } from "../lib/ai";
import { PROVIDERS, providerInfo, DEFAULT_PROVIDER_ID, DEFAULT_MODEL } from "../lib/providers";
import type { ProviderModel } from "../lib/providers";
import type { AiTask, Settings } from "../types";
import { AI_TASKS, AI_TASK_HINTS, AI_TASK_LABELS } from "../types";

const CUSTOM_MODEL = "__custom__";

export function SettingsPage() {
  const { data, updateSettings, exportData, importData, resetAllData, backup } = useStore();

  const [provider, setProvider] = useState(data.settings.provider);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(data.settings.apiKeys);
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>(data.settings.baseUrls);
  const [modelByProvider, setModelByProvider] = useState<Record<string, string>>({
    [data.settings.provider]: data.settings.model,
  });
  const [spendNote, setSpendNote] = useState(data.settings.spendNote);
  const [dailyGoal, setDailyGoal] = useState(data.settings.dailyGoal);
  const [taskModels, setTaskModels] = useState<Record<string, Partial<Record<AiTask, string>>>>(
    data.settings.taskModels,
  );
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const info = providerInfo(provider);
  const isOpenAiCompatible = info.kind === "openai-compatible";

  // Providers exposing a public model list get the live catalogue rather than a
  // hardcoded set that can go stale. Failures are non-fatal — the built-in
  // suggestions stay usable, and the custom-ID field always works.
  const [liveModels, setLiveModels] = useState<ProviderModel[] | null>(null);
  const [modelsState, setModelsState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  useEffect(() => {
    if (!info.modelsUrl) {
      setLiveModels(null);
      setModelsState("idle");
      return;
    }
    let cancelled = false;
    setModelsState("loading");
    fetchProviderModels(info.id)
      .then((models) => {
        if (cancelled || !models) return;
        setLiveModels(models);
        setModelsState("ok");
      })
      .catch(() => {
        if (!cancelled) setModelsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [info.id, info.modelsUrl]);

  const catalogue = liveModels ?? info.models;

  // The model for the provider currently selected, defaulting to its first
  // suggestion so switching providers never leaves a nonsense model ID behind.
  const model =
    modelByProvider[provider] ??
    (provider === DEFAULT_PROVIDER_ID ? DEFAULT_MODEL : info.models[0]?.id ?? "");
  const modelIsPreset = info.models.some((m) => m.id === model);
  const modelChoice = modelIsPreset ? model : CUSTOM_MODEL;
  // A live catalogue runs to hundreds of entries, so it gets a searchable text
  // input backed by a datalist rather than an unusable dropdown.
  const useDatalist = liveModels !== null && liveModels.length > 20;
  const selectedInfo = catalogue.find((m) => m.id === model);

  const overrideCount = Object.values(taskModels[provider] ?? {}).filter(
    (v) => (v ?? "").trim().length > 0,
  ).length;

  const apiKey = apiKeys[provider] ?? "";
  const baseUrl = baseUrls[provider] ?? info.baseUrl;

  // The settings that Save (or Test) would apply, assembled once.
  const draft = useMemo<Settings>(
    () => ({
      provider,
      model: model.trim(),
      apiKeys,
      baseUrls: { ...baseUrls, [provider]: baseUrl.trim() },
      // Blank overrides are dropped rather than stored as empty strings, so
      // "is anything overridden?" stays a simple key count.
      taskModels: {
        ...taskModels,
        [provider]: Object.fromEntries(
          Object.entries(taskModels[provider] ?? {}).filter(([, v]) => (v ?? "").trim().length > 0),
        ),
      },
      spendNote,
      dailyGoal,
    }),
    [provider, model, apiKeys, baseUrls, baseUrl, taskModels, spendNote, dailyGoal],
  );

  function setModel(next: string) {
    setModelByProvider((prev) => ({ ...prev, [provider]: next }));
  }

  function handleSave() {
    updateSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleTest() {
    setTestState("testing");
    setTestMessage(null);
    try {
      setTestMessage(await testConnection(draft));
      setTestState("ok");
    } catch (err) {
      setTestState("error");
      setTestMessage(err instanceof GradingError ? err.message : "Unknown error testing the connection.");
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importData(file);
      setImportMessage({ ok: true, text: `Imported data from ${file.name}.` });
    } catch (err) {
      setImportMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to import file." });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleReset() {
    if (
      confirm(
        "This will permanently erase all local progress, attempts, custom topics, and custom questions. Export a backup first?\n\nClick OK to erase, Cancel to keep your data.",
      )
    ) {
      resetAllData();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">AI provider, model, spend awareness, and your local data.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 660 }}>
        <div className="card-title">AI Provider</div>

        <div className="field">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setTestState("idle");
              setTestMessage(null);
            }}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {info.browserNote && <p className="field-hint">{info.browserNote}</p>}
        </div>

        <div className="field">
          <label htmlFor="apiKey">API key</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="apiKey"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
              placeholder={info.keyPlaceholder}
              autoComplete="off"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <p className="field-hint">
            Kept per provider, so switching back and forth doesn't lose your keys. Stored only in this browser's
            local storage and sent only to the provider you select.
            {info.keyUrl && (
              <>
                {" "}
                Get one at{" "}
                <a href={info.keyUrl} target="_blank" rel="noreferrer">
                  {info.keyLabel}
                </a>
                .
              </>
            )}
          </p>
        </div>

        {isOpenAiCompatible && (
          <div className="field">
            <label htmlFor="baseUrl">Base URL</label>
            <input
              id="baseUrl"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrls((prev) => ({ ...prev, [provider]: e.target.value }))}
              placeholder="https://api.example.com/v1"
            />
            <p className="field-hint">
              Everything up to but not including <code>/chat/completions</code>. Change this for a regional
              endpoint or a self-hosted gateway.
            </p>
          </div>
        )}

        <div className="field">
          <label htmlFor="model">Model</label>

          {useDatalist ? (
            <>
              <input
                id="model"
                type="text"
                list="model-catalogue"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="start typing — e.g. deepseek, qwen, kimi, claude"
                autoComplete="off"
              />
              <datalist id="model-catalogue">
                {catalogue.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </datalist>
            </>
          ) : (
            <>
              <select
                id="model"
                value={modelChoice}
                onChange={(e) => setModel(e.target.value === CUSTOM_MODEL ? "" : e.target.value)}
              >
                {info.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value={CUSTOM_MODEL}>Custom model ID...</option>
              </select>
              {modelChoice === CUSTOM_MODEL && (
                <input
                  type="text"
                  style={{ marginTop: 8 }}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="exact model ID from the provider's docs"
                />
              )}
            </>
          )}

          <p className="field-hint">
            Used for grading free-text answers, generating quizzes, and drafting notes.
            {modelsState === "loading" && " Loading the live model list..."}
            {modelsState === "ok" && ` ${catalogue.length} models available.`}
            {selectedInfo && <> Selected: {selectedInfo.label}.</>}
            {modelsState === "error" && (
              <>
                {" "}
                Couldn't load the live model list (offline, or the request was blocked), so these are built-in
                suggestions — any model ID the provider accepts still works.
              </>
            )}
            {modelsState === "idle" && " The suggestions are a starting point — any ID the provider accepts works."}
          </p>
        </div>

        {/* ---------- Per-task model overrides ----------
            Grading runs on every answer and only compares against a rubric
            that's already in the prompt; generation has to invent and solve a
            problem, and a wrong answer there persists in the bank. Those want
            different models, so each task can override the default. */}
        <details className="task-models">
          <summary>
            Use different models per task{" "}
            {overrideCount > 0 && <span className="badge badge-topic">{overrideCount} set</span>}
          </summary>
          <p className="field-hint" style={{ marginTop: 10 }}>
            Leave blank to use the model above. Overrides are kept per provider, since a model ID from one
            provider means nothing on another.
          </p>
          {AI_TASKS.map((task) => (
            <div className="field" key={task}>
              <label htmlFor={`task-${task}`}>{AI_TASK_LABELS[task]}</label>
              <input
                id={`task-${task}`}
                type="text"
                list={useDatalist ? "model-catalogue" : undefined}
                value={taskModels[provider]?.[task] ?? ""}
                onChange={(e) =>
                  setTaskModels((prev) => ({
                    ...prev,
                    [provider]: { ...(prev[provider] ?? {}), [task]: e.target.value },
                  }))
                }
                placeholder={`default: ${model || "(none)"}`}
                autoComplete="off"
              />
              <p className="field-hint">{AI_TASK_HINTS[task]}</p>
            </div>
          ))}
        </details>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn-primary" onClick={handleSave}>
            Save Settings
          </button>
          <button className="btn btn-secondary" onClick={handleTest} disabled={testState === "testing"}>
            {testState === "testing" ? (
              <>
                <span className="spinner dark" /> Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </button>
          {saved && <span style={{ color: "var(--green-600)", fontSize: 13, fontWeight: 600 }}>Saved ✓</span>}
        </div>

        {testMessage && (
          <div
            className={`banner ${testState === "ok" ? "banner-success" : "banner-error"}`}
            style={{ marginTop: 16, marginBottom: 0 }}
          >
            <p>{testMessage}</p>
          </div>
        )}
      </div>

      <div className="card" style={{ maxWidth: 660 }}>
        <div className="card-title">Practice</div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="dailyGoal">Daily goal (questions)</label>
          <input
            id="dailyGoal"
            type="number"
            min={1}
            max={100}
            value={dailyGoal}
            onChange={(e) => setDailyGoal(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            style={{ maxWidth: 120 }}
          />
          <p className="field-hint">
            How many questions a day counts as "practiced" for your streak. The streak counts consecutive
            calendar days that hit this — miss a day and it resets.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>
          Save Goal
        </button>
      </div>

      <div className="card" style={{ maxWidth: 660 }}>
        <div className="card-title">Spend Awareness</div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="spendNote">Personal budget note</label>
          <textarea
            id="spendNote"
            value={spendNote}
            onChange={(e) => setSpendNote(e.target.value)}
            rows={3}
            placeholder="e.g. Cap monthly API spend at $20 — check the provider's usage page if drilling heavily."
          />
          <p className="field-hint">
            QuantPrep doesn't track live spend — this is just a reminder shown to you. Check actual usage in your
            provider's console (
            <a href="https://console.anthropic.com/settings/cost" target="_blank" rel="noreferrer">
              Anthropic
            </a>
            ,{" "}
            <a href="https://openrouter.ai/activity" target="_blank" rel="noreferrer">
              OpenRouter
            </a>
            ). Local models cost nothing.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>
          Save Note
        </button>
        {spendNote.trim().length > 0 && (
          <div className="banner banner-info" style={{ marginTop: 16, marginBottom: 0 }}>
            <p>{spendNote}</p>
          </div>
        )}
      </div>

      <div className="card" style={{ maxWidth: 660 }}>
        <div className="card-title">Continuous Backup</div>
        {backup.state === "unsupported" ? (
          <p className="muted" style={{ marginTop: 0 }}>
            Auto-saving to a file needs the File System Access API, which this browser doesn't support (currently
            Chrome, Edge, and other Chromium browsers). Use <strong>Export to JSON</strong> below instead — it
            works everywhere.
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Pick a file once and QuantPrep writes your full progress to it every time anything changes — no
              remembering to export. The file is a normal JSON backup you can drop straight back in via{" "}
              <strong>Import from JSON</strong>. Put it in Dropbox or iCloud Drive and it syncs across machines.
            </p>

            <div className={`backup-status backup-${backup.state}`}>
              {backup.state === "off" && <span>Not backing up — everything is in this browser only.</span>}
              {backup.state === "connected" && (
                <span>
                  Auto-saving to <strong>{backup.fileName}</strong>
                  {backup.lastSavedAt
                    ? ` · last saved ${new Date(backup.lastSavedAt).toLocaleTimeString()}`
                    : " · waiting for the first change"}
                </span>
              )}
              {backup.state === "reconnect" && (
                <span>
                  <strong>{backup.fileName}</strong> is remembered, but the browser needs your permission again
                  before it can write. Nothing has been backed up this session.
                </span>
              )}
              {backup.state === "error" && (
                <span>Backup failed: {backup.error ?? "unknown error"}. The file may have been moved or deleted.</span>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              {backup.state === "reconnect" ? (
                <button className="btn btn-primary" onClick={() => void backup.reconnect()}>
                  Reconnect {backup.fileName}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => void backup.choose()}>
                  {backup.state === "off" ? "Choose backup file..." : "Change backup file..."}
                </button>
              )}
              {backup.state === "connected" && (
                <button className="btn btn-secondary" onClick={() => void backup.saveNow()}>
                  Save now
                </button>
              )}
              {backup.state !== "off" && (
                <button className="btn btn-secondary" onClick={() => void backup.disconnect()}>
                  Stop backing up
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ maxWidth: 660 }}>
        <div className="card-title">Your Data</div>
        <p className="muted" style={{ marginTop: 0 }}>
          {data.questions.length} questions · {data.attempts.length} attempts logged · {data.studyNotes.length}{" "}
          study notes ({data.customTopics.length} your own). All progress lives in this browser's local storage
          under <code>quantprep_data_v2</code> — it survives restarts, but it is tied to this browser at this exact
          URL. Export regularly.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={exportData}>
            Export to JSON
          </button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            Import from JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
          <button className="btn btn-danger" onClick={handleReset}>
            Erase All Data
          </button>
        </div>
        {importMessage && (
          <div
            className={`banner ${importMessage.ok ? "banner-success" : "banner-error"}`}
            style={{ marginTop: 16, marginBottom: 0 }}
          >
            <p>{importMessage.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}
