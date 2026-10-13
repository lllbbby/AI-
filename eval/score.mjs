// 词组匹配只筛选待人工复核的结果，不判定分析或改译在语义上正确。
const hasFocus = (target, finding) => {
  const text = `${finding.lossType || ''}\n${finding.evidence || ''}\n${finding.suggestion || ''}`.toLowerCase();
  return target.evidenceGroups.every(group => group.some(term => text.includes(term.toLowerCase())));
};

// 每条模型结果最多对应一处预先标注的问题，避免一条堆词结果得到多项分数。
const assignFindings = (targets, findings, withContext) => {
  const owner = Array(findings.length).fill(-1);
  const visit = (targetIndex, seen) => {
    for (let findingIndex = 0; findingIndex < findings.length; findingIndex++) {
      const finding = findings[findingIndex];
      if (seen.has(findingIndex) || !hasFocus(targets[targetIndex], finding)) continue;
      if (withContext && Object.hasOwn(targets[targetIndex], 'needsContext')
        && finding.needsContext !== targets[targetIndex].needsContext) continue;
      seen.add(findingIndex);
      if (owner[findingIndex] < 0 || visit(owner[findingIndex], seen)) {
        owner[findingIndex] = targetIndex;
        return true;
      }
    }
    return false;
  };
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) visit(targetIndex, new Set());
  const assigned = Array(targets.length).fill(-1);
  owner.forEach((targetIndex, findingIndex) => { if (targetIndex >= 0) assigned[targetIndex] = findingIndex; });
  return assigned;
};

export function scoreCase(item, result) {
  if (item.expected.decision === 'clean') {
    return { passed: result.findings.length === 0, findingCount: result.findings.length,
      reason: result.findings.length === 0 ? '合理译文未被报错' : '对合理译文产生了复核项' };
  }
  const expected = item.expected.findings || [item.expected];
  const focusAssignments = assignFindings(expected, result.findings, false);
  const contextAssignments = assignFindings(expected, result.findings, true);
  const checks = expected.map((target, index) => ({
    title: target.title || item.title,
    focusMatched: focusAssignments[index] >= 0,
    contextMatched: contextAssignments[index] >= 0,
    findingIndex: contextAssignments[index],
  }));
  const focusMatched = checks.every(check => check.focusMatched);
  const contextMatched = checks.every(check => check.contextMatched);
  const matchedCount = checks.filter(check => check.contextMatched).length;
  const extraFindingCount = result.findings.length - matchedCount;
  const passed = contextMatched && extraFindingCount === 0;
  return {
    passed, findingCount: result.findings.length, focusMatched, contextMatched, extraFindingCount,
    ...(item.expected.findings ? { checks, expectedCount: checks.length, matchedCount } : {}),
    reason: !focusMatched ? '部分标注差异未找到独立对应项' : !contextMatched ? '部分对应项的上下文条件不符'
      : extraFindingCount ? '存在未标注的额外复核项，需人工判断' : '词组及条件初筛通过，仍需人工核对证据与改译',
  };
}

export function summarize(rows) {
  const successful = rows.filter(row => row.result);
  const positives = successful.filter(row => row.expectedDecision !== 'clean');
  const negatives = successful.filter(row => row.expectedDecision === 'clean');
  return {
    total: rows.length, validResponses: successful.length,
    passed: rows.filter(row => row.score?.passed).length,
    positiveCases: positives.length, positivePassed: positives.filter(row => row.score.passed).length,
    cleanCases: negatives.length, falsePositives: negatives.filter(row => !row.score.passed).length,
    extraFindingsToReview: positives.reduce((sum, row) => sum + (row.score.extraFindingCount || 0), 0),
    apiErrors: rows.filter(row => row.error).length,
    inputTokens: rows.reduce((sum, row) => sum + (row.usage?.prompt_tokens || 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row.usage?.completion_tokens || 0), 0),
  };
}
