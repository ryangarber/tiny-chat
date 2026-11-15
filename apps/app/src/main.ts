import { createRuntime } from "#app/client-runtime.ts";
import { mount } from "#gui/mount.tsx";

void createRuntime().then((runtime) => mount({ runtime }));
