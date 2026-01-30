// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import asap from "@architect/asap";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";

initSentry();

export const handler = adaptHttpHandler(
  handlingErrors(
    asap({
      spa: true,
    })
  )
);

