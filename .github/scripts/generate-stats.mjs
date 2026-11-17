import fs from "node:fs";

const TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || "Varian08";
const OUTPUT_PATH = process.env.OUTPUT_PATH || "stats.svg";

if (!TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}

async function fetchStats() {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          restrictedContributionsCount
          totalPullRequestReviewContributions
        }
        pullRequests(first: 1) {
          totalCount
        }
        issues(first: 1) {
          totalCount
        }
      }
    }
  `;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        login: USERNAME,
        from: oneYearAgo.toISOString(),
        to: now.toISOString(),
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const u = json.data.user;
  const c = u.contributionsCollection;
  return {
    commits: (c.totalCommitContributions || 0) + (c.restrictedContributionsCount || 0),
    prs: u.pullRequests.totalCount || 0,
    reviews: c.totalPullRequestReviewContributions || 0,
    issues: u.issues.totalCount || 0,
  };
}

function renderSvg(stats) {
  const width = 450;
  const height = 140;
  const rows = [
    { label: "Total Commits (last year):", value: stats.commits },
    { label: "Total PRs:", value: stats.prs },
    { label: "Total PRs Reviewed:", value: stats.reviews },
    { label: "Total Issues:", value: stats.issues },
  ];

  const rowEls = rows
    .map((r, idx) => {
      const y = idx * 19;
      return `<g transform="translate(0, ${y})">
      <text x="0" y="0" class="stat">${r.label}</text>
      <text x="195" y="0" class="stat">${r.value}</text>
    </g>`;
    })
    .join("\n    ");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub Stats">
  <style>
    .header { font: 600 15.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #4f8cc9; }
    .stat { font: 600 12px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; fill: #9e9e9e; }
  </style>
  <rect x="0.5" y="0.5" rx="6.1" height="${height - 1}" stroke="#343434" width="${
    width - 1
  }" fill="#000000" fill-opacity="0"/>
  <g transform="translate(25, 35)">
    <text x="0" y="0" class="header">GitHub Stats</text>
  </g>
  <g transform="translate(25, 62)">
    ${rowEls}
  </g>
</svg>
`;
}

async function main() {
  const stats = await fetchStats();
  console.log("Fetched GitHub Stats (with private):", stats);
  const svg = renderSvg(stats);
  fs.writeFileSync(OUTPUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
