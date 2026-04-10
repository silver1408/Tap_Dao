export async function requestProposalProblemSummary({ apiPost, proposal }) {
  const response = await apiPost(
    "/proposals/summarize-problem",
    {
      title: proposal.title,
      description: proposal.description || "",
    },
    "Failed to summarize proposal",
  );

  return {
    summary: response.summary,
    model: response.model,
  };
}
