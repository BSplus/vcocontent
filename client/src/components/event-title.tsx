import React from "react";

interface EventTitleProps {
  title: string;
}

/**
 * Displays event titles without modifying the title received from the API.
 * Preserve VCO's preferred iRACING brand casing through uppercase headings.
 */
export default function EventTitle({ title }: EventTitleProps) {
  return (
    <>
      {title.split(/(iracing)/gi).map((part, index) =>
        /^iracing$/i.test(part) ? (
          <span key={index} style={{ textTransform: "none" }}>iRACING</span>
        ) : part
      )}
    </>
  );
}
