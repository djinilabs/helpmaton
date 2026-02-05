import type { FC } from "react";

import {
  DetailPageNav,
  type DetailPageNavGroup,
  type DetailPageNavItem,
  type DetailPageNavProps,
} from "./DetailPageNav";

export type AgentDetailNavItem = DetailPageNavItem;
export type AgentDetailNavGroup = DetailPageNavGroup;
export type AgentDetailNavProps = DetailPageNavProps;

export const AgentDetailNav: FC<AgentDetailNavProps> = (props) => (
  <DetailPageNav
    {...props}
    ariaLabel="Agent sections"
    headerTitle="Sections"
  />
);
