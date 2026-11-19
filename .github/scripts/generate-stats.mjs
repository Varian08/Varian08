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
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
        pullRequests(first: 1) {
          totalCount
        }
        issues(first: 1) {
          totalCount
        }
        repositoriesContributedTo(
          first: 1
          contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, PULL_REQUEST_REVIEW]
          includeUserRepositories: true
        ) {
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

  // Aggregate contributionCalendar into the last 12 calendar months (oldest -> newest)
  const monthKeys = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthKeys.push(key);
  }
  const monthMap = Object.fromEntries(monthKeys.map((k) => [k, 0]));
  for (const week of c.contributionCalendar?.weeks || []) {
    for (const day of week.contributionDays || []) {
      const key = day.date.slice(0, 7);
      if (key in monthMap) {
        monthMap[key] += day.contributionCount || 0;
      }
    }
  }

  return {
    commits: (c.totalCommitContributions || 0) + (c.restrictedContributionsCount || 0),
    prs: u.pullRequests.totalCount || 0,
    reviews: c.totalPullRequestReviewContributions || 0,
    issues: u.issues.totalCount || 0,
    activeRepos: u.repositoriesContributedTo.totalCount || 0,
    monthlyCounts: monthKeys.map((k) => monthMap[k]),
  };
}

const ICONS = {
  commit: `<path fill-rule="evenodd" d="M10.5 7.75a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm1.43.75a4.002 4.002 0 01-7.86 0H.75a.75.75 0 110-1.5h3.32a4.001 4.001 0 017.86 0h3.32a.75.75 0 110 1.5h-3.32z"/>`,
  pr: `<path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>`,
  review: `<path fill-rule="evenodd" d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 010 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 010-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2zM1.679 7.932a.12.12 0 000 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 000-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717zM8 10a2 2 0 100-4 2 2 0 000 4z"/>`,
  issue: `<path fill-rule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z"/>`,
};

function renderSvg(stats) {
  const width = 450;
  const height = 140;
  const leftRows = [
    { icon: ICONS.commit, label: "Total Commits (1y):", value: stats.commits },
    { icon: ICONS.pr, label: "Total PRs:", value: stats.prs },
  ];
  const rightRows = [
    { icon: ICONS.review, label: "PRs Reviewed (1y):", value: stats.reviews },
    { icon: ICONS.issue, label: "Total Issues:", value: stats.issues },
  ];

  const renderCol = (rows, valX) =>
    rows
      .map((r, idx) => {
        const y = idx * 25;
        return `<g transform="translate(0, ${y})">
      <svg x="0" y="-11" width="14" height="14" viewBox="0 0 16 16" fill="#4f8cc9">${r.icon}</svg>
      <text x="20" y="0" class="stat">${r.label}</text>
      <text x="${valX}" y="0" text-anchor="end" class="stat-val">${r.value}</text>
    </g>`;
      })
      .join("\n    ");

  const counts = stats.monthlyCounts || new Array(12).fill(0);
  const maxCount = Math.max(...counts, 1);
  const barWidth = 26;
  const barGap = 8;
  const maxBarH = 12;
  const microBars = counts
    .map((count, i) => {
      const h = count === 0 ? 2 : Math.max(3, Math.round((count / maxCount) * maxBarH));
      const x = i * (barWidth + barGap);
      const y = maxBarH - h;
      let fill = "#262626";
      if (count > 0) {
        if (count === maxCount) fill = "#6cb6ff";
        else if (count >= maxCount * 0.5) fill = "#4f8cc9";
        else fill = "#355d87";
      }
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="1.5" fill="${fill}"/>`;
    })
    .join("\n    ");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub Stats">
  <style>
    .header { font: 600 15.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #4f8cc9; }
    .stat { font: 600 12px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; fill: #9e9e9e; }
    .stat-val { font: 400 12px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; fill: #9e9e9e; }
  </style>
  <rect x="0.5" y="0.5" rx="6.1" height="${height - 1}" stroke="#343434" width="${
    width - 1
  }" fill="#000000" fill-opacity="0"/>
  <g transform="translate(25, 35)">
    <text x="0" y="0" class="header">GitHub Stats</text>
  </g>
  <g transform="translate(25, 51)">
    ${microBars}
  </g>
  <g transform="translate(25, 92)">
    ${renderCol(leftRows, 182)}
  </g>
  <line x1="227" y1="80" x2="227" y2="121" stroke="#343434" stroke-width="1"/>
  <g transform="translate(247, 92)">
    ${renderCol(rightRows, 178)}
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
