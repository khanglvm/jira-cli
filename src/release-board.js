const RELEASE_ISSUE_FIELDS = [
  "summary",
  "description",
  "status",
  "priority",
  "assignee",
  "reporter",
  "issuetype",
  "project",
  "labels",
  "components",
  "fixVersions",
  "created",
  "updated",
  "resolution",
  "resolutiondate",
  "parent",
  "subtasks",
];

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CHILD_CONCURRENCY = 6;
const MAX_RELEASE_ISSUES = 5000;

function text(value) {
  return value === undefined || value === null ? null : String(value);
}

function issueKeyCompare(left, right) {
  return String(left?.key || "").localeCompare(String(right?.key || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function userSummary(user) {
  if (!user) return null;
  return {
    name: text(user.name),
    key: text(user.key),
    displayName: text(user.displayName),
    active: user.active ?? null,
  };
}

function normalizeIssue(issue, relationship, parentKey = null) {
  const fields = issue?.fields || {};
  return {
    key: text(issue?.key),
    id: text(issue?.id),
    relationship,
    parentKey: text(fields.parent?.key || parentKey),
    summary: text(fields.summary),
    description: text(fields.description),
    issueType: text(fields.issuetype?.name),
    subtask: fields.issuetype?.subtask ?? null,
    status: text(fields.status?.name),
    statusCategory: text(fields.status?.statusCategory?.name),
    resolution: text(fields.resolution?.name),
    priority: text(fields.priority?.name),
    assignee: userSummary(fields.assignee),
    reporter: userSummary(fields.reporter),
    projectKey: text(fields.project?.key),
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    components: Array.isArray(fields.components) ? fields.components.map((item) => text(item?.name)).filter(Boolean) : [],
    fixVersions: Array.isArray(fields.fixVersions)
      ? fields.fixVersions.map((item) => ({ id: text(item?.id), name: text(item?.name) }))
      : [],
    created: text(fields.created),
    updated: text(fields.updated),
    resolutionDate: text(fields.resolutiondate),
  };
}

function errorSummary(error, details = {}) {
  return {
    ...details,
    statusCode: error?.statusCode ?? null,
    error: error?.name || "Error",
    message: error?.message || String(error),
  };
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function parseReleaseBoardReference(reference, expectedBaseUrl) {
  const value = String(reference || "").trim();
  if (/^\d+$/.test(value)) {
    return { input: value, versionId: value, projectKey: null, url: null };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("releaseBoard must be a Jira version URL or numeric version id");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("releaseBoard URL must use http or https");
  }
  if (expectedBaseUrl) {
    const expected = new URL(expectedBaseUrl);
    if (url.origin !== expected.origin) {
      throw new Error(`releaseBoard host ${url.origin} does not match Jira profile ${expected.origin}`);
    }
  }

  const match = url.pathname.match(/\/projects\/([^/]+)\/versions\/(\d+)\/?$/i);
  if (!match) {
    throw new Error("releaseBoard URL must match /projects/<project-key>/versions/<version-id>");
  }
  return {
    input: value,
    versionId: match[2],
    projectKey: decodeURIComponent(match[1]).toUpperCase(),
    url: url.toString(),
  };
}

async function readDirectIssues(client, projectKey, versionId, pageSize) {
  const issues = [];
  let startAt = 0;
  let total = null;
  let pages = 0;
  const jql = `project = "${projectKey.replace(/"/g, '\\"')}" AND fixVersion = ${versionId} ORDER BY key ASC`;

  while (total === null || startAt < total) {
    const page = await client.search(jql, pageSize, startAt, RELEASE_ISSUE_FIELDS);
    const pageIssues = Array.isArray(page?.issues) ? page.issues : [];
    total = Number(page?.total ?? pageIssues.length);
    pages += 1;
    if (total > MAX_RELEASE_ISSUES) {
      throw new Error(`Release board contains ${total} direct issues; limit is ${MAX_RELEASE_ISSUES}`);
    }
    if (pageIssues.length === 0 && startAt < total) {
      throw new Error(`Jira returned an empty release page at ${startAt} of ${total}`);
    }
    issues.push(...pageIssues);
    startAt += pageIssues.length;
  }

  return { issues, total: total || 0, pages, jql };
}

function releaseSummary(version, project, reference, baseUrl) {
  const canonicalUrl = baseUrl
    ? `${String(baseUrl).replace(/\/$/, "")}/projects/${encodeURIComponent(project.key)}/versions/${encodeURIComponent(version.id)}`
    : reference.url;
  return {
    id: text(version.id),
    name: text(version.name),
    description: text(version.description),
    project: {
      id: text(project.id),
      key: text(project.key),
      name: text(project.name),
    },
    startDate: text(version.startDate),
    releaseDate: text(version.releaseDate),
    released: version.released ?? false,
    archived: version.archived ?? false,
    overdue: version.overdue ?? null,
    url: canonicalUrl || null,
  };
}

export async function readReleaseBoard(client, {
  releaseBoard,
  pageSize = DEFAULT_PAGE_SIZE,
  childConcurrency = DEFAULT_CHILD_CONCURRENCY,
} = {}) {
  const size = Math.max(1, Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, 1000));
  const concurrency = Math.max(1, Math.min(Number(childConcurrency) || DEFAULT_CHILD_CONCURRENCY, 20));
  const reference = parseReleaseBoardReference(releaseBoard, client?.profile?.baseUrl);
  const version = await client.getVersion(reference.versionId);
  const [project, unresolvedCounts, relatedCounts] = await Promise.all([
    client.getProject(version.projectId),
    client.getVersionUnresolvedIssueCount(reference.versionId),
    client.getVersionRelatedIssueCounts(reference.versionId),
  ]);

  const projectKey = text(project?.key)?.toUpperCase();
  if (!projectKey) throw new Error(`Jira version ${reference.versionId} has no readable project`);
  if (reference.projectKey && reference.projectKey !== projectKey) {
    throw new Error(`Release board project ${reference.projectKey} does not match Jira version project ${projectKey}`);
  }

  const direct = await readDirectIssues(client, projectKey, reference.versionId, size);
  const childRequests = [];
  for (const issue of direct.issues) {
    for (const child of issue?.fields?.subtasks || []) {
      if (child?.key) childRequests.push({ parentKey: issue.key, issue: child });
    }
  }
  const uniqueChildren = [...new Map(childRequests.map((item) => [item.issue.key, item])).values()]
    .sort((left, right) => issueKeyCompare(left.issue, right.issue));
  const childErrors = [];
  const hydratedChildren = await mapConcurrent(uniqueChildren, concurrency, async ({ parentKey, issue }) => {
    try {
      const hydrated = await client.getIssue(issue.key, RELEASE_ISSUE_FIELDS.join(","));
      return normalizeIssue(hydrated, "child", parentKey);
    } catch (error) {
      childErrors.push(errorSummary(error, { parentKey, issueKey: issue.key, phase: "child_hydration" }));
      return normalizeIssue(issue, "child", parentKey);
    }
  });

  const childrenByParent = new Map();
  for (const child of hydratedChildren) {
    const values = childrenByParent.get(child.parentKey) || [];
    values.push(child);
    childrenByParent.set(child.parentKey, values);
  }
  const issues = direct.issues
    .map((issue) => ({
      ...normalizeIssue(issue, "direct"),
      parent: issue?.fields?.parent ? normalizeIssue(issue.fields.parent, "parent") : null,
      children: (childrenByParent.get(issue.key) || []).sort(issueKeyCompare),
    }))
    .sort(issueKeyCompare);

  const allIssues = [...issues, ...hydratedChildren];
  const byStatusCategory = {};
  for (const issue of allIssues) {
    const category = issue.statusCategory || "Unknown";
    byStatusCategory[category] = (byStatusCategory[category] || 0) + 1;
  }
  const expectedFixed = Number(relatedCounts?.issuesFixedCount ?? direct.total);
  const countMismatch = expectedFixed !== direct.total;
  const errors = [...childErrors];
  if (countMismatch) {
    errors.push({
      phase: "membership_count",
      expected: expectedFixed,
      returned: direct.total,
      message: "Jira related issue count differs from the paginated fixVersion search",
    });
  }

  return {
    source: reference,
    release: releaseSummary(version, project, reference, client?.profile?.baseUrl),
    counts: {
      direct: direct.total,
      children: hydratedChildren.length,
      total: allIssues.length,
      unresolvedDirect: Number(unresolvedCounts?.issuesUnresolvedCount ?? 0),
      affected: Number(relatedCounts?.issuesAffectedCount ?? 0),
      byStatusCategory,
    },
    issues,
    issueKeys: [...new Set(allIssues.flatMap((issue) => [issue.key, issue.parentKey]).filter(Boolean))]
      .sort((left, right) => issueKeyCompare({ key: left }, { key: right })),
    completeness: {
      complete: errors.length === 0,
      directIssuePages: direct.pages,
      childrenRequested: uniqueChildren.length,
      childrenHydrated: uniqueChildren.length - childErrors.length,
      errors,
    },
  };
}

export { RELEASE_ISSUE_FIELDS };
