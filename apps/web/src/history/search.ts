import type { MeetingRecord } from "./db";

export function searchMeetings(
  meetings: MeetingRecord[],
  query: string,
): MeetingRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return meetings;
  return meetings.filter((meeting) =>
    [
      meeting.title,
      meeting.manualNotes,
      ...meeting.transcript.map((segment) => segment.text),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
