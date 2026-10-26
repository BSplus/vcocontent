import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardEventList, { EVENTS_PER_PAGE, getEventPage } from "../client/src/components/dashboard-event-list.tsx";

const events = Array.from({ length: 19 }, (_, index) => ({
  id: index + 1,
  title: index === 0 ? "  Alpine Rally  " : `Race ${index + 1}`,
  date: new Date(2025, 0, index + 1),
}));

test("events are sorted newest first, paged, clamped, and searched by title", () => {
  assert.equal(getEventPage(events, "", 1).visible.length, EVENTS_PER_PAGE);
  assert.equal(getEventPage(events, "", 1).visible[0].id, 19);
  assert.equal(getEventPage(events, "", 2).visible[0].id, 11);
  assert.equal(getEventPage(events, "", 99).currentPage, 3);
  assert.equal(getEventPage(events, "", 99).visible.length, 3);
  assert.deepEqual(getEventPage(events, " ALPINE ", 2).visible.map(event => event.id), [1]);
  assert.equal(getEventPage(events, "missing", 1).visible.length, 0);
});

test("empty and no-match states differ, rows show stats and actions, pagination has boundaries", () => {
  const props = { title: "VCO Events", mediaItems: [], search: "", emptyMessage: "No VCO events created yet.", actions: () => React.createElement("button", null, "Manage Media") };
  const empty = renderToStaticMarkup(React.createElement(DashboardEventList, { ...props, events: [] }));
  assert.match(empty, /No VCO events created yet/);
  const noMatch = renderToStaticMarkup(React.createElement(DashboardEventList, { ...props, events, search: "unfindable" }));
  assert.match(noMatch, /No events match your search/);
  const rows = renderToStaticMarkup(React.createElement(DashboardEventList, { ...props, events, mediaItems: [
    { eventId: 19, type: "image", downloadCount: 3 },
    { eventId: 19, type: "video", downloadCount: 2 },
  ] }));
  assert.match(rows, /Race 19/);
  assert.doesNotMatch(rows, /Race 1</);
  assert.match(rows, /1 Photo</);
  assert.match(rows, /1 Video</);
  assert.match(rows, /5 Downloads/);
  assert.match(rows, /Manage Media/);
  assert.match(rows.replace(/<!--.*?-->/g,""), /PAGE 1 OF 3/);
  assert.match(rows, /disabled=""[^>]*>Previous/);
});

for (const count of [0, 1, 2]) {
  test(`rendered dashboard stats use correct forms for ${count}`, () => {
    const html = renderToStaticMarkup(React.createElement(DashboardEventList, {
      title: "Events", events: [events[0]], mediaItems: [], search: "", emptyMessage: "",
      eventCounts: new Map([[events[0].id, { photos: count, videos: count, downloads: count }]]),
      actions: () => null,
    }));
    for (const word of ["Photo", "Video", "Download"]) {
      assert.ok(html.includes(`${count} ${word}${count === 1 ? "" : "s"}<`));
    }
    assert.doesNotMatch(html, /1 (Photos|Videos|Downloads)</);
  });
}