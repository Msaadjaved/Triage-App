"use client";

import { useEffect, useState } from "react";

export type Settings = {
  strategy: "llm" | "dm" | "dm+llm";
  promptVersion: "v1" | "v2";
  model: string; // "" = server default
};

export const DEFAULT_SETTINGS: Settings = { strategy: "llm", promptVersion: "v2", model: "" };

type Config = { models: string[]; defaultModel: string; dmModel: string; threshold: number };

export default function StrategyPicker({
  value,
  onChange,
  disabled,
}: {
  value: Settings;
  onChange: (next: Settings) => void;
  disabled?: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => setConfig(c))
      .catch(() => setConfig(null));
  }, []);

  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  const usesLlm = value.strategy !== "dm";

  return (
    <fieldset className="picker" disabled={disabled}>
      <label>
        Strategy
        <select value={value.strategy} onChange={(e) => set({ strategy: e.target.value as Settings["strategy"] })}>
          <option value="llm">llm: LLM only</option>
          <option value="dm">dm: decision model only</option>
          <option value="dm+llm">dm+llm: DM first, LLM if unsure</option>
        </select>
      </label>
      <label>
        Prompt
        <select
          value={value.promptVersion}
          onChange={(e) => set({ promptVersion: e.target.value as Settings["promptVersion"] })}
          disabled={!usesLlm}
        >
          <option value="v1">triage v1</option>
          <option value="v2">triage v2</option>
        </select>
      </label>
      <label>
        LLM model
        <select value={value.model} onChange={(e) => set({ model: e.target.value })} disabled={!usesLlm}>
          <option value="">default{config ? ` (${config.defaultModel})` : ""}</option>
          {config?.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {config && value.strategy !== "llm" && (
        <small>
          DM: {config.dmModel}
          {value.strategy === "dm+llm" && ` (LLM takes over below ${config.threshold} confidence)`}
        </small>
      )}
    </fieldset>
  );
}
