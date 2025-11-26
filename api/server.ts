import { serve, write } from "bun";
import fs from "fs";
import { cp, mkdir, access } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const TEMPLATE_DIR = path.resolve("./template");
const OUTPUT_DIR = path.resolve("../components");

const TEMPLATE_LOCKS = new Map<string, Promise<any>>();

function run_command(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    console.log(`[cmd] ${command} ${args.join(" ")} @ ${cwd}`);
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: true });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", (err) => reject(err));
  });
}

async function update_package_json(target_dir: string, name: string) {
  const pkg_path = path.join(target_dir, "package.json");
  if (!fs.existsSync(pkg_path)) return;

  const pkg = JSON.parse(fs.readFileSync(pkg_path, "utf-8"));
  pkg.name = name;

  if (pkg.scripts) {
    for (const key of Object.keys(pkg.scripts)) {
      pkg.scripts[key] = pkg.scripts[key].replace(/\btemplate\b/g, name);
    }
  }

  fs.writeFileSync(pkg_path, JSON.stringify(pkg, null, 2));
}

async function create_template(name: string) {
  const target_dir = path.join(OUTPUT_DIR, name);
  await mkdir(target_dir, { recursive: true });
  await cp(TEMPLATE_DIR, target_dir, { recursive: true, force: true });

  await update_package_json(target_dir, name);

  // install & build
  // NOTE: pnpm may use a shared store and locks; we serialize operations per-template using queue
  await run_command("pnpm", ["install"], target_dir);
  await run_command("pnpm", ["build"], target_dir);
}

async function update_view(name: string, content: string) {
  const view_path = path.join(OUTPUT_DIR, name + '/src', "App.vue");

  try {
    await access(view_path);
    await write(view_path, content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`App.vue not found in the specified template directory: ${view_path}`);
    }

    throw new Error(`File system error occurred for template ${name}.`);
  }
}

async function update_server(name: string, content: string) {
  const server_path = path.join(OUTPUT_DIR, name + '/src', "server.ts");

  try {
    await access(server_path);
    await write(server_path, content);
  } catch (error: any) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`server.ts not found in the specified template directory: ${server_path}`);
    }
    throw new Error(`File system error occurred for template ${name}: ${error?.message ?? error}`);
  }
}

function queue(name: string, task: () => Promise<Response>) {
  const last = TEMPLATE_LOCKS.get(name) || Promise.resolve(null);

  const next = last
    .then(() => task())
    .catch((err) => {
      if (TEMPLATE_LOCKS.get(name) === next) {
        TEMPLATE_LOCKS.delete(name);
      }
      throw err;
    });

  TEMPLATE_LOCKS.set(name, next);
  next.finally(() => {
    if (TEMPLATE_LOCKS.get(name) === next) {
      TEMPLATE_LOCKS.delete(name);
    }
  });

  return next;
}

serve({
  port: 8089,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/create/template' && req.method === "POST") {
      const payload = await req.json();
      const name = payload.name?.trim();

      if (!name || /[\/\\]/.test(name)) {
        return new Response("Invalid template name", { status: 400 });
      }

      return await queue(name, async () => {
        try {
          await create_template(name);
          const body = JSON.stringify({
            url: `https://intcsp.mspbots.ai/${name}/1.0.0/~preview/?__ocAcceptLanguage=*&tenant_code=1285403951449878530`
          });
          return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
        } catch (err: any) {
          console.error(`create_template error for ${name}:`, err);
          const message = err?.message ?? String(err);
          return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
      })
    }

    if (url.pathname === '/update/template' && req.method === "POST") {
      const payload = await req.json();
      const name = payload.name?.trim();
      const { view, server } = payload;

      if (!name || /[\/\\]/.test(name)) {
        return new Response("Invalid template name", { status: 400 });
      }

      return await queue(name, async () => {
        try {
          if (view) await update_view(name, view);
          if (server) await update_server(name, server);

          if (view || server) {
            const target_dir = path.join(OUTPUT_DIR, name);
            await run_command("pnpm", ["install"], target_dir);
            await run_command("pnpm", ["build"], target_dir);
          }

          const body = JSON.stringify({
            message: `Template '${name}' updated successfully.`,
            url: `https://intcsp.mspbots.ai/${name}/1.0.0/~preview/?__ocAcceptLanguage=*&tenant_code=1285403951449878530`
          });
          return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
        } catch (err: any) {
          console.error(`update_template error for ${name}:`, err);
          const message = err?.message ?? String(err);
          return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
      })
    }

    return new Response("not found", { status: 404 });
  },
});

console.log("Server running on http://localhost:8089");