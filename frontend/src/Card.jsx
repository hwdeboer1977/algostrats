import React from "react";

export default function Card({ title, children, actions }) {
  return (
    <div className="card">
      {title ? <div className="card__title">{title}</div> : null}
      <div className="card__body">{children}</div>
      {actions ? <div className="card__actions">{actions}</div> : null}
    </div>
  );
}
