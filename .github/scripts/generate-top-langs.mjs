import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || "Varian08";
const OUTPUT_PATH = process.env.OUTPUT_PATH || "top-langs.svg";

if (!TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}

const EXT_MAP = {
  ".java": { name: "Java", color: "#b07219" },
  ".dart": { name: "Dart", color: "#00B4AB" },
  ".go": { name: "Go", color: "#00ADD8" },
  ".ts": { name: "TypeScript", color: "#3178c6" },
  ".tsx": { name: "TypeScript", color: "#3178c6" },
  ".js": { name: "JavaScript", color: "#f1e05a" },
  ".jsx": { name: "JavaScript", color: "#f1e05a" },
  ".svelte": { name: "Svelte", color: "#ff3e00" },
  ".html": { name: "HTML", color: "#e34c26" },
  ".htm": { name: "HTML", color: "#e34c26" },
  ".css": { name: "CSS", color: "#563d7c" },
  ".scss": { name: "SCSS", color: "#c6538c" },
  ".cpp": { name: "C++", color: "#f34b7d" },
  ".cc": { name: "C++", color: "#f34b7d" },
  ".cxx": { name: "C++", color: "#f34b7d" },
  ".hpp": { name: "C++", color: "#f34b7d" },
  ".c": { name: "C", color: "#555555" },
  ".h": { name: "C", color: "#555555" },
  ".py": { name: "Python", color: "#3572A5" },
  ".cs": { name: "C#", color: "#178600" },
  ".sql": { name: "SQL", color: "#e38c00" },
  ".sh": { name: "Shell", color: "#89e051" },
  ".ps1": { name: "PowerShell", color: "#012456" },
};

const IGNORE_SUFFIXES = [
  ".g.dart",
  ".freezed.dart",
  ".sql.go",
  ".min.js",
  ".min.css",
  ".d.ts",
];

async function ghFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${url}: ${body}`);
  }
  return res.json();
}

async function fetchAllRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(
      `https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      if (!r.archived && !r.fork) {
        repos.push(r.full_name);
      }
    }
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

async function fetchAuthorCommits(fullName) {
  const shas = [];
  let page = 1;
  while (true) {
    let batch;
    try {
      batch = await ghFetch(
        `https://api.github.com/repos/${fullName}/commits?author=${encodeURIComponent(
          USERNAME
        )}&per_page=100&page=${page}`
      );
    } catch {
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const c of batch) {
      if (Array.isArray(c.parents) && c.parents.length <= 1) {
        shas.push(c.sha);
      }
    }
    if (batch.length < 100) break;
    page++;
  }
  return shas;
}

function classifyFile(filename) {
  const lower = filename.toLowerCase();
  for (const suf of IGNORE_SUFFIXES) {
    if (lower.endsWith(suf)) return null;
  }
  const ext = path.extname(lower);
  return EXT_MAP[ext] || null;
}

async function mapPool(items, limit, fn) {
  let idx = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      await fn(current);
    }
  });
  await Promise.all(workers);
}

function escapeXml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSvg(topLangs) {
  const width = 450;
  const height = 140;
  const barWidth = 400;
  const barX = 25;
  const barY = 55;

  let currentX = 0;
  const barSegments = topLangs
    .map((lang, i) => {
      const w =
        i === topLangs.length - 1
          ? Math.max(0, barWidth - currentX)
          : (lang.pct / 100) * barWidth;
      const seg = `<rect mask="url(#rect-mask)" x="${currentX.toFixed(
        2
      )}" y="0" width="${w.toFixed(2)}" height="8" fill="${lang.color}"/>`;
      currentX += w;
      return seg;
    })
    .join("\n      ");

  const legendItems = topLangs
    .map((lang, i) => {
      const col = Math.floor(i / 2);
      const row = i % 2;
      const tx = col * 135;
      const ty = row * 25;
      return `<g transform="translate(${tx}, ${ty})">
      <circle cx="5" cy="6" r="5" fill="${lang.color}"/>
      <text x="15" y="10" class="lang-name">${escapeXml(lang.name)} ${lang.pct.toFixed(
        2
      )}%</text>
    </g>`;
    })
    .join("\n    ");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Most Used Languages">
  <style>
    .header { font: 600 15.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #4f8cc9; }
    .lang-name { font: 600 12px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; fill: #cfcfcf; }
  </style>
  <rect x="0.5" y="0.5" rx="6.1" height="${height - 1}" stroke="#343434" width="${
    width - 1
  }" fill="#000000" fill-opacity="0"/>
  <g transform="translate(25, 35)">
    <text x="0" y="0" class="header">Most Used Languages</text>
  </g>
  <g transform="translate(${barX}, ${barY})">
    <defs>
      <mask id="rect-mask">
        <rect x="0" y="0" width="${barWidth}" height="8" fill="white" rx="4"/>
      </mask>
    </defs>
    ${barSegments}
  </g>
  <g transform="translate(25, 80)">
    ${legendItems}
  </g>
</svg>
`;
}

async function main() {
  const repos = await fetchAllRepos();
  console.log(`Found ${repos.length} non-fork repositories.`);

  const commitJobs = [];
  for (const repo of repos) {
    const shas = await fetchAuthorCommits(repo);
    for (const sha of shas) {
      commitJobs.push({ repo, sha });
    }
  }
  console.log(`Found ${commitJobs.length} non-merge commits by ${USERNAME}.`);

  const totals = new Map();
  await mapPool(commitJobs, 8, async ({ repo, sha }) => {
    try {
      const detail = await ghFetch(
        `https://api.github.com/repos/${repo}/commits/${sha}`
      );
      if (!Array.isArray(detail.files)) return;
      for (const f of detail.files) {
        const lang = classifyFile(f.filename);
        if (!lang || !f.additions) continue;
        const prev = totals.get(lang.name) || { ...lang, lines: 0 };
        prev.lines += f.additions;
        totals.set(lang.name, prev);
      }
    } catch {
      // Ignore inaccessible individual commit
    }
  });

  const sorted = [...totals.values()]
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 6);

  const totalLines = sorted.reduce((acc, l) => acc + l.lines, 0) || 1;
  const topLangs = sorted.map((l) => ({
    ...l,
    pct: (l.lines / totalLines) * 100,
  }));

  console.log("Top 6 Languages (by authored lines added):", topLangs);
  const svg = renderSvg(topLangs);
  fs.writeFileSync(OUTPUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
