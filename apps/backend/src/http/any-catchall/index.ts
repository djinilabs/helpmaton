// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import asap from "@architect/asap";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";

export const handler = adaptHttpHandler(
  handlingErrors(
    asap({
      spa: true,
    })
  )
);

