import { useRef, useState } from "react";
import { useStore } from "../lib/store";
import { testConnection, GradingError } from "../lib/anthropic";

const MODEL_OPTIONS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (default)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-opus-5", label: "Claude Opus 5 (highest quality, pricier)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest, cheapest)" },
  { id: "custom", label: "Custom model ID..." },
];

export function SettingsPage() {
  const { data, updateSettings, exportData, importData, resetAllData } = useStore();
  const [apiKeyInput, setApiKeyInput] = useState(data.settings.apiKey);
  const [showKey, setShowKey] = useState(false);
  const knownModel = MODEL_OPTIONS.some((m) => m.id === data.settings.model);
  const [modelChoice, setModelChoice] = useState(knownModel ? data.settings.model : "custom");
  const [customModel, setCustomModel] = useState(knownModel ? "" : data.settings.model);
  const [spendNote, setSpendNote] = useState(data.settings.spendNote);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveModel = modelChoice === "custom" ? customModel.trim() : modelChoice;

  function handleSave() {
    updateSettings({
      apiKey: apiKeyInput.trim(),
      model: effectiveModel || "claude-sonnet-4-6",
      spendNote,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleTest() {
    setTestState("testing");
    setTestMessage(null);
    try {
      await testConnection(apiKeyInput.trim(), effectiveModel || "claude-sonnet-4-6");
      setTestState("ok");
      setTestMessage("Connection successful — Claude responded.");
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
    if (confirm("This will permanently erase all local progress, attempts, and custom questions. Export a backup first?\n\nClick OK to erase, Cancel to keep your data.")) {
      resetAllData();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">API key, model, spend awareness, and your local data.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <div className="card-title">Anthropic API</div>

        <div className="field">
          <label htmlFor="apiKey">API key</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="apiKey"
              type={showKey ? "text" : "password"}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <p className="field-hint">
            Stored only in this browser's local storage. Never sent anywhere except directly to api.anthropic.com
            when grading. Get a key at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            .
          </p>
        </div>

        <div className="field">
          <label htmlFor="model">Grading model</label>
          <select id="model" value={modelChoice} onChange={(e) => setModelChoice(e.target.value)}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {modelChoice === "custom" && (
            <input
              type="text"
              style={{ marginTop: 8 }}
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="e.g. claude-opus-4-8"
            />
          )}
          <p className="field-hint">Used for grading free-text answers in Drill, Review, and Mock modes.</p>
        </div>

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
          <div className={`banner ${testState === "ok" ? "banner-success" : "banner-error"}`} style={{ marginTop: 16, marginBottom: 0 }}>
            <p>{testMessage}</p>
          </div>
        )}
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <div className="card-title">Spend Awareness</div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="spendNote">Personal budget note</label>
          <textarea
            id="spendNote"
            value={spendNote}
            onChange={(e) => setSpendNote(e.target.value)}
            rows={3}
            placeholder="e.g. Cap monthly Anthropic spend at $20 — check console.anthropic.com/settings/cost if drilling heavily."
          />
          <p className="field-hint">
            QuantPrep doesn't track live spend — this is just a reminder shown to you. Check actual usage in the{" "}
            <a href="https://console.anthropic.com/settings/cost" target="_blank" rel="noreferrer">
              Anthropic Console
            </a>
            .
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

      <div className="card" style={{ maxWidth: 620 }}>
        <div className="card-title">Your Data</div>
        <p className="muted" style={{ marginTop: 0 }}>
          {data.questions.length} questions · {data.attempts.length} attempts logged. All progress lives in this
          browser's local storage — export regularly so you never lose it.
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
          <div className={`banner ${importMessage.ok ? "banner-success" : "banner-error"}`} style={{ marginTop: 16, marginBottom: 0 }}>
            <p>{importMessage.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}
