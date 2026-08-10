"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Sparkles } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type SpecialistRow = {
  id: string;
  label: string;
  shortLabel: string;
  group: string;
};

type SkillRow = {
  name: string;
  description: string;
  specialists: string[];
  dirName: string;
  source: "builtin" | "user";
  enabled: boolean;
  maxChars: number;
  disabledSpecialists: string[];
  bodyPreview: string;
  bodyChars: number;
  activeFor: string[];
};

type SkillsPayload = {
  defaultMaxChars: number;
  minChars: number;
  maxCharsCap: number;
  specialists: SpecialistRow[];
  skills: SkillRow[];
};

export function SkillsStudioCard() {
  const [data, setData] = useState<SkillsPayload | null>(null);
  const [specialistId, setSpecialistId] = useState("secretary");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [proposeName, setProposeName] = useState("");
  const [proposeDescription, setProposeDescription] = useState("");
  const [proposeBody, setProposeBody] = useState("");
  const [proposeSpecialists, setProposeSpecialists] = useState<string[]>(["secretary"]);
  const [proposing, setProposing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<SkillsPayload>("/settings/skills", { silent: true });
      setData(payload);
      if (!payload.specialists.some((s) => s.id === specialistId) && payload.specialists[0]) {
        setSpecialistId(payload.specialists[0].id);
      }
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Could not load Skills studio.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // mount load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleSkills = useMemo(() => {
    if (!data) return [];
    return data.skills.filter((s) => {
      const targets = s.specialists.map((x) => x.toLowerCase());
      return targets.includes("*") || targets.includes(specialistId);
    });
  }, [data, specialistId]);

  const patchSkill = async (dirName: string, patch: Record<string, unknown>) => {
    setSaving(dirName);
    setNote(null);
    setError(null);
    try {
      await apiPut("/settings/skills", { prefs: { [dirName]: patch } });
      await load();
      setNote("Skills prefs saved in Product vault.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save skill prefs.");
    } finally {
      setSaving(null);
    }
  };

  const toggleForSpecialist = async (skill: SkillRow, enabled: boolean) => {
    await patchSkill(skill.dirName, {
      specialistId,
      enabledForSpecialist: enabled,
    });
  };

  const setTrim = async (skill: SkillRow, maxChars: number) => {
    await patchSkill(skill.dirName, { maxChars });
  };

  const toggleMaster = async (skill: SkillRow, enabled: boolean) => {
    await patchSkill(skill.dirName, { enabled });
  };

  const toggleProposeSpecialist = (id: string) => {
    setProposeSpecialists((prev) => {
      if (id === "*") return ["*"];
      const withoutStar = prev.filter((x) => x !== "*");
      if (withoutStar.includes(id)) {
        const next = withoutStar.filter((x) => x !== id);
        return next.length ? next : [specialistId];
      }
      return [...withoutStar, id];
    });
  };

  const propose = async () => {
    setProposing(true);
    setNote(null);
    setError(null);
    try {
      const res = await apiPost<{ confirmation: { id: string }; dirName: string }>(
        "/settings/skills/propose",
        {
          name: proposeName,
          description: proposeDescription,
          body: proposeBody,
          specialists: proposeSpecialists,
        },
      );
      setProposeName("");
      setProposeDescription("");
      setProposeBody("");
      setNote(
        `Proposed “${res.dirName}” — confirm under Needs your confirmation before it injects.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not propose skill.");
    } finally {
      setProposing(false);
    }
  };

  if (loading && !data) {
    return (
      <Card id="skills-studio">
        <CardHeader>
          <CardTitle className="text-base">Skills studio</CardTitle>
          <CardDescription>Loading specialist SOPs…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card id="skills-studio">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-destructive" />
            Skills studio
          </CardTitle>
          <CardDescription>Could not load skill registry</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">{error ?? "API unreachable."}</p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="skills-studio">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-primary" />
          Skills studio
        </CardTitle>
        <CardDescription>
          View, toggle, and trim injected skills per specialist. Prefs live in the Product vault.
          Propose a new skill → confirm before it persists.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {data.specialists.map((sp) => (
            <Button
              key={sp.id}
              type="button"
              size="sm"
              variant={specialistId === sp.id ? "default" : "outline"}
              onClick={() => setSpecialistId(sp.id)}
            >
              {sp.shortLabel}
            </Button>
          ))}
        </div>

        <div className="space-y-3">
          {visibleSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No skills assigned to this specialist yet. Propose one below.
            </p>
          ) : (
            visibleSkills.map((skill) => {
              const onForSpecialist = skill.activeFor.includes(specialistId);
              const busy = saving === skill.dirName;
              return (
                <div
                  key={skill.dirName}
                  className="space-y-2 rounded-xl border border-border/70 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">{skill.name}</p>
                      <p className="text-xs text-muted-foreground">{skill.description}</p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <Badge variant="outline">{skill.source}</Badge>
                        <Badge variant="outline">{skill.bodyChars} chars</Badge>
                        {!skill.enabled ? <Badge variant="destructive">Off globally</Badge> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={onForSpecialist ? "default" : "outline"}
                        disabled={busy || !skill.enabled}
                        onClick={() => void toggleForSpecialist(skill, !onForSpecialist)}
                      >
                        {onForSpecialist ? "On for specialist" : "Off for specialist"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void toggleMaster(skill, !skill.enabled)}
                      >
                        {skill.enabled ? "Disable all" : "Enable all"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{skill.bodyPreview}</p>
                  <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    Trim inject
                    <Input
                      type="number"
                      min={data.minChars}
                      max={data.maxCharsCap}
                      step={40}
                      className="h-8 w-28 font-mono text-xs"
                      value={skill.maxChars}
                      disabled={busy}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setData({
                          ...data,
                          skills: data.skills.map((s) =>
                            s.dirName === skill.dirName ? { ...s, maxChars: n } : s,
                          ),
                        });
                      }}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) void setTrim(skill, n);
                      }}
                    />
                    <span>chars (default {data.defaultMaxChars})</span>
                  </label>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-dashed border-border/70 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            Propose new skill
          </p>
          <p className="text-xs text-muted-foreground">
            Stages a confirmation — nothing is written until you Confirm on Home / Needs your
            confirmation.
          </p>
          <Input
            value={proposeName}
            onChange={(e) => setProposeName(e.target.value)}
            placeholder="Skill name (e.g. hotel-scout)"
          />
          <Input
            value={proposeDescription}
            onChange={(e) => setProposeDescription(e.target.value)}
            placeholder="Short description"
          />
          <Textarea
            value={proposeBody}
            onChange={(e) => setProposeBody(e.target.value)}
            placeholder="SOP body — steps the specialist should follow when relevant"
            className="min-h-[120px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={proposeSpecialists.includes("*") ? "default" : "outline"}
              onClick={() => setProposeSpecialists(["*"])}
            >
              All specialists
            </Button>
            {data.specialists.map((sp) => (
              <Button
                key={sp.id}
                type="button"
                size="sm"
                variant={
                  !proposeSpecialists.includes("*") && proposeSpecialists.includes(sp.id)
                    ? "default"
                    : "outline"
                }
                onClick={() => toggleProposeSpecialist(sp.id)}
              >
                {sp.shortLabel}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            disabled={
              proposing || !proposeName.trim() || !proposeDescription.trim() || !proposeBody.trim()
            }
            onClick={() => void propose()}
          >
            {proposing ? "Proposing…" : "Propose → confirm"}
          </Button>
        </div>

        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
