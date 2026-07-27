import { createHash } from "node:crypto";

export default {
  MD5(value: string) {
    return { toString: () => createHash("md5").update(value).digest("hex") };
  },
};
