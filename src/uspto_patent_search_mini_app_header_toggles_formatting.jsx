import React, { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search, Clipboard, Check, AlertCircle, Bug, ExternalLink } from "lucide-react";

// ---------------- Helpers ----------------
function extractRecords(json: any): any[] {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.results)) return json.results;
  if (json.results && Array.isArray(json.results.records)) return json.results.records;
  if (Array.isArray(json.records)) return json.records;
  if (json.response && Array.isArray(json.response.docs)) return json.response.docs;
  if (Array.isArray(json.items)) return json.items;
  if (json.data && Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.patentFileWrapperDataBag)) return json.patentFileWrapperDataBag; // USPTO wrapper
  if (json.searchResult && Array.isArray(json.searchResult.records)) return json.searchResult.records;
  return [];
}

function safeGet<T = any>(obj: any, path: (string | number)[], fallback?: any): T | undefined {
  try { return path.reduce((o: any, k: any) => (o == null ? undefined : o[k]), obj) ?? fallback; } catch { return fallback; }
}

function firstTruthy<T = any>(...vals: (T | undefined | null | "")[]): T | undefined {
  for (const v of vals) { if (v !== undefined && v !== null && String(v).trim() !== "") return v as T; }
  return undefined;
}

function parseFromXmlFileName(xml?: string) {
  if (!xml) return {} as any;
  const m = xml.match(/(\d{6,9})_(\d{6,8})\.xml$/);
  if (m) {
    const a = m[1];
    const p = m[2];
    const app = a.length === 8 ? a : undefined;
    const pat = p;
    return { applicationNumberText: app, patentNumber: pat };
  }
  return {} as any;
}

function parseGrantDateFallback(rec: any): string | undefined {
  const d1 = firstTruthy(safeGet(rec, ["applicationMetaData", "grantDate"]), rec.grantDate);
  if (d1) return d1;
  const events: any[] = safeGet(rec, ["eventDataBag"], []) || [];
  const issue = events.find((e) => /patent issue date/i.test(String(e.eventDescriptionText)) || String(e.eventCode).toUpperCase() === "PTAC");
  if (issue?.eventDate) return issue.eventDate;
  const src = firstTruthy<string>(safeGet(rec, ["grantDocumentMetaData", "zipFileName"]), safeGet(rec, ["grantDocumentMetaData", "fileLocationURI"])) || "";
  const ipg = src.match(/ipg(\d{6})/i);
  if (ipg) { const yymmdd = ipg[1]; const y = parseInt("20" + yymmdd.slice(0, 2)); return `${y}-${yymmdd.slice(2,4)}-${yymmdd.slice(4,6)}`; }
  return undefined;
}

function formatAddress(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const fields = ["addressLineOne","addressLineTwo","addressLineThree","streetLineOne","streetLineTwo","city","state","province","postalCode","zipCode","country","countryCode"];
  const picked: string[] = [];
  for (const k of fields) { const v = (obj as any)[k]; if (v && typeof v !== "object") picked.push(String(v)); }
  if (!picked.length) {
    const all: string[] = []; for (const [, v] of Object.entries(obj)) { if (typeof v !== "object" && String(v).trim() !== "") all.push(String(v)); }
    if (all.length) return all.join(", ");
  }
  return picked.length ? picked.join(", ") : undefined;
}

function extractApplicants(rec: any): { name?: string; address?: string }[] {
  const out: { name?: string; address?: string }[] = [];
  const bags: any[] = (firstTruthy(safeGet(rec, ["applicantBag"]), safeGet(rec, ["bibliographicData", "parties", "applicants"]), safeGet(rec, ["applicationMetaData", "applicantBag"])) as any[]) || [];
  const arr = Array.isArray(bags) ? bags : [];
  for (const a of arr) {
    const name = firstTruthy(a?.applicantNameText, safeGet(a, ["applicantNameBag", "applicantNameText"]), safeGet(a, ["applicantName", "name"]), a?.name);
    const addr = firstTruthy(formatAddress(a?.correspondenceAddressBag), formatAddress(safeGet(a, ["addressBag"])));
    out.push({ name, address: addr });
  }
  return out;
}

function extractSummary(rec: any) {
  const app = firstTruthy(rec?.applicationNumberText, safeGet(rec, ["applicationMetaData", "applicationNumberText"]), safeGet(rec, ["bibliographicData", "applicationIdentifier", "applicationNumberText"]), parseFromXmlFileName(safeGet(rec, ["grantDocumentMetaData", "xmlFileName"]))?.applicationNumberText);
  const pat = firstTruthy(rec?.patentNumber, safeGet(rec, ["applicationMetaData", "patentNumber"]), safeGet(rec, ["bibliographicData", "patentNumber"]), parseFromXmlFileName(safeGet(rec, ["grantDocumentMetaData", "xmlFileName"]))?.patentNumber);
  const pub = firstTruthy(rec?.earliestPublicationNumber, safeGet(rec, ["applicationMetaData", "earliestPublicationNumber"]), safeGet(rec, ["documentIdBag", "publicationDocumentId", "documentId"]), safeGet(rec, ["bibliographicData", "publicationIdentifier", "documentId"]));
  const grant = parseGrantDateFallback(rec);
  const applicants = extractApplicants(rec);
  return { applicationNumberText: app, patentNumber: pat, earliestPublicationNumber: pub, grantDate: grant, applicants };
}

// Publication parsing without brittle regex
function parsePublicationInput(raw: string): { base: string; kind?: "A1" | "A2" | "A9" | "A" } | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, ""); // keep only A-Z0-9
  // Expected shapes now become e.g. US20240088251A1, 20240088251A1, US20240088251, 20240088251
  let i = 0;
  if (s.startsWith("US")) i = 2;
  const year = s.slice(i, i + 4);
  const seq = s.slice(i + 4, i + 11);
  if (!/^\d{4}$/.test(year) || !/^\d{7}$/.test(seq)) return null;
  const rest = s.slice(i + 11);
  let kind: any = undefined;
  if (rest.startsWith("A")) {
    if (rest.length === 1) kind = "A"; // partial kind
    else if (["1", "2", "9"].includes(rest[1])) kind = ("A" + rest[1]) as any;
  }
  return { base: `US${year}${seq}`, kind };
}

function dedupe<T = any>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) { const k = keyFn(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// --- Formatting helpers ---
function formatApplicationNumberDisplay(app?: string): string | undefined {
  if (!app) return undefined;
  const digits = String(app).replace(/\D/g, "");
  if (digits.length !== 8) return app; // only format canonical 2+6 digits
  return `${digits.slice(0, 2)}/${digits.slice(2, 5)},${digits.slice(5)}`; // nn/nnn,nnn
}

function formatPatentNumberDisplay(pat?: string): string | undefined {
  if (!pat) return undefined;
  const digits = String(pat).replace(/\D/g, "");
  if (!digits) return pat;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ","); // 6 -> nnn,nnn; 7 -> n,nnn,nnn; 8 -> nn,nnn,nnn
}

// ---------------- Component ----------------
export default function USPTOPatentSearchMiniApp() {
  const [apiKey, setApiKey] = useState("");
  const [searchType, setSearchType] = useState<"publication" | "application" | "patent">("publication");
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [multiResultWarning, setMultiResultWarning] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [showResponse, setShowResponse] = useState(false); // hidden by default

  const endpoint = "https://api.uspto.gov/api/v1/patent/applications/search";

  const filterName = useMemo(() => {
    switch (searchType) {
      case "publication": return "applicationMetaData.earliestPublicationNumber";
      case "application": return "applicationNumberText";
      case "patent": return "applicationMetaData.patentNumber";
    }
  }, [searchType]);

  const placeholder = useMemo(() => {
    switch (searchType) {
      case "publication": return "USYYYYXXXXXXXA* (e.g. US20240088251A1 or US 2024/0088251)";
      case "application": return "Series(2)+Serial(6), e.g. 15745021";
      case "patent": return "6-8 digits, e.g. 11578110";
    }
  }, [searchType]);

  function sanitizeInput(input: string) {
    let clean = input.replace(/[\s,\-\/]/g, "").toUpperCase();
    if (searchType === "publication") {
      const parsed = parsePublicationInput(input);
      if (parsed) return `${parsed.base}|${parsed.kind || ""}`;
      if (!clean.startsWith("US")) clean = "US" + clean;
      const m = clean.match(/^US(\d{4})(\d{7})([A-Z]\d?)?$/);
      if (m) { const base = `US${m[1]}${m[2]}`; const kind = m[3] || ""; return `${base}|${kind}`; }
      throw new Error("Publication number must be US + 4-digit year + 7-digit sequence, optional kind A1/A2/A9.");
    }
    if (searchType === "application") { clean = clean.replace(/\D/g, ""); if (!/^\d{8}$/.test(clean)) throw new Error("Application number must be 8 digits: 2-digit series + 6-digit serial."); }
    if (searchType === "patent") { clean = clean.replace(/\D/g, ""); if (!/^\d{6,8}$/.test(clean)) throw new Error("Patent number must be 6-8 digits."); }
    return clean;
  }

  function buildPayload(value: string) {
    return { q: null, filters: [{ name: filterName, value: [value] }], rangeFilters: [], pagination: { offset: 0, limit: 25 }, sort: [{ field: "applicationMetaData.filingDate", order: "Desc" }] } as const;
  }

  async function runSearch() {
    setError(null); setData(null); setMultiResultWarning(false); setLoading(true);
    try {
      if (!apiKey) throw new Error("Please enter your USPTO x-api-key.");
      if (!identifier.trim()) throw new Error("Please enter a value to search.");

      const sanitized = sanitizeInput(identifier);
      let candidates: string[] = [sanitized];
      let displayLabel = sanitized;

      if (searchType === "publication") {
        const [base, kind] = sanitized.split("|");
        const allowed = ["A1", "A2", "A9"] as const;
        const kinds = (!kind || kind === "A") ? allowed : (allowed.includes(kind as any) ? [kind as any] : []);
        if (kinds.length === 0) throw new Error("Kind code must be A1, A2, or A9.");
        candidates = kinds.map(k => base + k);
        displayLabel = `${base}(${kinds.join("/")})`;
      }

      candidates = dedupe(candidates, (x) => x);

      const merged: any[] = [];
      let total = 0;

      for (const candidate of candidates) {
        const res = await fetch(endpoint, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": apiKey }, body: JSON.stringify(buildPayload(candidate)) });
        if (!res.ok) {
          if (res.status === 404) { continue; }
          const text = await res.text(); throw new Error(`HTTP ${res.status} - ${text.substring(0, 400)}`);
        }
        const json = await res.json();
        const recs = extractRecords(json);
        if (recs.length > 0) { merged.push(...recs); total += recs.length; continue; }
        if (typeof json.count === "number" && json.count > 0) { const bag = Array.isArray(json.patentFileWrapperDataBag) ? json.patentFileWrapperDataBag : [json]; merged.push(...bag); total += json.count; }
      }

      if (total === 0) throw new Error(`No results found for ${displayLabel}.`);
      if (total > 1) setMultiResultWarning(true);
      setData({ results: merged });
      setShowResponse(false); // keep raw hidden by default after each search
    } catch (e: any) { setError(e?.message || "Unknown error"); }
    finally { setLoading(false); }
  }

  function copyJSON() { if (!data) return; navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }

  // ---------------- Self-tests ----------------
  type Test = { name: string; ok: boolean; details?: string };
  const [tests, setTests] = useState<Test[]>([]);
  function runTests(): Test[] {
    const out: Test[] = [];
    try { const p = parsePublicationInput("US20240088251A1"); out.push({ name: "pub exact no sep", ok: !!p && p.base === "US20240088251" && p.kind === "A1" }); } catch (e: any) { out.push({ name: "pub exact no sep", ok: false, details: e?.message }); }
    try { const p = parsePublicationInput("US 2024/0088251"); out.push({ name: "pub with space+slash no kind", ok: !!p && p.base === "US20240088251" && (p.kind === undefined || p.kind === "A") }); } catch (e: any) { out.push({ name: "pub with space+slash no kind", ok: false, details: e?.message }); }
    try { const p = parsePublicationInput("2024/0088251 A1"); out.push({ name: "pub missing US", ok: !!p && p.base === "US20240088251" && p.kind === "A1" }); } catch (e: any) { out.push({ name: "pub missing US", ok: false, details: e?.message }); }
    try { const p = parsePublicationInput("US-2024-0088251-A"); out.push({ name: "pub hyphen partial kind", ok: !!p && p.base === "US20240088251" && p.kind === "A" }); } catch (e: any) { out.push({ name: "pub hyphen partial kind", ok: false, details: e?.message }); }
    try { const digits = "15-745,021".replace(/\D/g, ""); out.push({ name: "application 8 digits", ok: /^\d{8}$/.test(digits) }); } catch (e: any) { out.push({ name: "application 8 digits", ok: false, details: e?.message }); }
    try { const digits = "11,578,110".replace(/\D/g, ""); out.push({ name: "patent 6-8 digits", ok: /^\d{6,8}$/.test(digits) }); } catch (e: any) { out.push({ name: "patent 6-8 digits", ok: false, details: e?.message }); }
    // Display formatting
    try { const s = formatApplicationNumberDisplay("15745021"); out.push({ name: "format app nn/nnn,nnn", ok: s === "15/745,021", details: String(s) }); } catch (e: any) { out.push({ name: "format app nn/nnn,nnn", ok: false, details: e?.message }); }
    try { const s = formatPatentNumberDisplay("11578110"); out.push({ name: "format patent commas", ok: s === "11,578,110", details: String(s) }); } catch (e: any) { out.push({ name: "format patent commas", ok: false, details: e?.message }); }
    return out;
  }
  useEffect(() => { setTests(runTests()); }, []);

  // Build summary from first result
  const summary = useMemo(() => {
    if (!data?.results?.length) return null;
    const first = data.results[0];
    const app = firstTruthy(first?.applicationNumberText, safeGet(first, ["applicationMetaData", "applicationNumberText"]), safeGet(first, ["bibliographicData", "applicationIdentifier", "applicationNumberText"]), parseFromXmlFileName(safeGet(first, ["grantDocumentMetaData", "xmlFileName"]))?.applicationNumberText);
    const pat = firstTruthy(first?.patentNumber, safeGet(first, ["applicationMetaData", "patentNumber"]), safeGet(first, ["bibliographicData", "patentNumber"]), parseFromXmlFileName(safeGet(first, ["grantDocumentMetaData", "xmlFileName"]))?.patentNumber);
    const pub = firstTruthy(first?.earliestPublicationNumber, safeGet(first, ["applicationMetaData", "earliestPublicationNumber"]), safeGet(first, ["documentIdBag", "publicationDocumentId", "documentId"]), safeGet(first, ["bibliographicData", "publicationIdentifier", "documentId"]));
    const grant = parseGrantDateFallback(first);
    const applicants = extractApplicants(first);
    return { applicationNumberText: app, patentNumber: pat, earliestPublicationNumber: pub, grantDate: grant, applicants };
  }, [data]);

  const maintenanceUrl = useMemo(() => {
    const pat = summary?.patentNumber || ""; const app = summary?.applicationNumberText || "";
    const base = "https://fees.uspto.gov/MaintenanceFees/fees/details";
    return `${base}?patentNumber=${encodeURIComponent(pat)}&applicationNumber=${encodeURIComponent(app)}&caresActSelected=`;
  }, [summary]);

  // Formatted display strings
  const formattedApp = useMemo(() => formatApplicationNumberDisplay(summary?.applicationNumberText) || summary?.applicationNumberText, [summary]);
  const formattedPat = useMemo(() => formatPatentNumberDisplay(summary?.patentNumber) || summary?.patentNumber, [summary]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">USPTO Patent Center - Search Helper</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowTests(v => !v)}><Bug className="w-4 h-4 mr-2" />{showTests ? "Hide" : "Show"} tests</Button>
            <Button variant="outline" onClick={() => setShowResponse(v => !v)}>{showResponse ? "Hide" : "Show"} response</Button>
          </div>
        </header>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="apiKey">USPTO x-api-key</Label>
                <Input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Enter your x-api-key" />
              </div>
              <div className="space-y-2">
                <Label>Search by</Label>
                <Select value={searchType} onValueChange={(v) => setSearchType(v as any)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="publication">Publication number</SelectItem>
                    <SelectItem value="application">Application number</SelectItem>
                    <SelectItem value="patent">Patent number</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="identifier">Value</Label>
                <Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={placeholder} />
                <p className="text-xs text-gray-600">We accept formats like "US20240088251A1", "US 2024/0088251", or "2024/0088251 A1" - separators are optional.</p>
              </div>
              <div className="md:col-span-2 flex items-center gap-3 pt-2">
                <Button onClick={runSearch} disabled={loading}>{loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Searching</>) : (<><Search className="mr-2 h-4 w-4" /> Search</>)}</Button>
                {error && <span className="text-sm text-red-600">{error}</span>}
              </div>
              {multiResultWarning && (
                <div className="md:col-span-2 flex items-center text-amber-600 text-sm"><AlertCircle className="h-4 w-4 mr-2" /> Multiple results found. Please refine your search.</div>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* Summary */}
        {summary && (
          <Card className="shadow-sm">
            <CardHeader>
              <div className="text-lg font-medium">Summary</div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><span className="font-medium">Application number:</span> {formattedApp || <em>Not available</em>}</div>
                <div><span className="font-medium">Patent number:</span> {formattedPat || <em>Not available</em>}</div>
                <div><span className="font-medium">Earliest publication:</span> {summary.earliestPublicationNumber || <em>Not available</em>}</div>
                <div><span className="font-medium">Grant date:</span> {summary.grantDate || <em>Not available</em>}</div>
              </div>
              <div className="mt-4">
                <div className="font-medium text-sm mb-1">Applicants</div>
                {summary.applicants && summary.applicants.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {summary.applicants.map((a, idx) => (
                      <li key={idx}>{a.name || <em>Unknown name</em>}{a.address ? <span className="text-gray-600"> - {a.address}</span> : null}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-600">No applicant data found.</div>
                )}
              </div>
              <div className="mt-4">
                <Button asChild disabled={!summary.patentNumber && !summary.applicationNumberText}>
                  <a href={maintenanceUrl} target="_blank" rel="noreferrer">Maintenance Fees Storefront <ExternalLink className="w-4 h-4 ml-2" /></a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Raw response (shown only when toggled) */}
        {showResponse && (
          <Card className="shadow-sm">
            <CardHeader>
              <div className="text-lg font-medium">Response (raw JSON)</div>
            </CardHeader>
            <CardContent>
              {!data && !loading && <p className="text-sm text-gray-600">Run a search to see results here.</p>}
              {data && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600">Showing extracted results.</div>
                    <Button variant="outline" size="sm" onClick={copyJSON}>{copied ? (<><Check className="mr-2 h-4 w-4" /> Copied</>) : (<><Clipboard className="mr-2 h-4 w-4" /> Copy JSON</>)}</Button>
                  </div>
                  <Textarea readOnly className="font-mono text-xs h-[420px]" value={JSON.stringify(data, null, 2)} />
                </div>
              )}
              {loading && (<div className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Fetching...</div>)}
            </CardContent>
          </Card>
        )}

        {/* Tests */}
        {showTests && (
          <Card className="shadow-sm">
            <CardHeader>
              <div className="text-lg font-medium">Self-tests</div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between"><p className="text-sm text-gray-600">Quick checks ensure parsing and formatting are robust.</p><Button size="sm" variant="outline" onClick={() => setTests(runTests())}>Run tests</Button></div>
              <ul className="mt-3 text-sm list-disc pl-5">{tests.map((t, i) => (<li key={i} className={t.ok ? "text-emerald-700" : "text-red-700"}>{t.name}: {t.ok ? "OK" : `FAIL${t.details ? " - " + t.details : ""}`}</li>))}</ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
