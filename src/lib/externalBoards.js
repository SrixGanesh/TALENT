// ============================================================
// External job board "push" (LinkedIn, Naukri, etc.)
//
// Reality check, read before wiring real accounts in:
//   - LinkedIn has no open "post a job" API. Posting programmatically
//     requires LinkedIn's Talent/Recruiter System Connect partner program —
//     a business approval process, not just an API key.
//   - Naukri has a similar RMS (Recruiter Management System) partner API,
//     also gated behind a business/partner agreement.
// Neither can be wired up as a simple fetch() call from a hobby/prototype
// app. So this module gives you a clean seam to plug real credentials into
// LATER (once you have partner access), and in the meantime marks the job
// as "pushed_external" in our own DB so the workflow (internal review ->
// external open -> pushed to boards) is fully modeled end-to-end.
// ============================================================

import { setJobStatus } from "./db";

const SUPPORTED_BOARDS = ["linkedin", "naukri"];

// Swap this stub body for real API calls once partner credentials exist.
async function postToBoard(board, job) {
  if (!SUPPORTED_BOARDS.includes(board)) throw new Error(`Unsupported board: ${board}`);
  await new Promise((r) => setTimeout(r, 400)); // simulated network round-trip
  return { board, postedJobId: `${board}-mock-${job.id.slice(0, 8)}`, status: "queued" };
}

export async function pushJobToExternalBoards(job, boards = SUPPORTED_BOARDS) {
  const results = await Promise.all(boards.map((b) => postToBoard(b, job)));
  await setJobStatus(job.id, "pushed_external", boards);
  return results;
}
