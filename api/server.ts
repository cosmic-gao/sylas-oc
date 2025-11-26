import { serve, write } from "bun";
import fs from "fs";
import { cp, mkdir, access } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const TEMPLATE_DIR = path.resolve("./template");
const OUTPUT_DIR = path.resolve("../components");

function run_command(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: true });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function update_package_json(targetDir: string, name: string) {
  const pkgPath = path.join(targetDir, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  pkg.name = name;

  if (pkg.scripts) {
    for (const key of Object.keys(pkg.scripts)) {
      pkg.scripts[key] = pkg.scripts[key].replace(/\btemplate\b/g, name);
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
}

async function create_template(name: string) {
  const targetDir = path.join(OUTPUT_DIR, name);
  await mkdir(targetDir, { recursive: true });
  await cp(TEMPLATE_DIR, targetDir, { recursive: true, force: true });

  await update_package_json(targetDir, name);

  await run_command("pnpm", ["install"], targetDir);
  await run_command("pnpm", ["build"], targetDir);
}

async function update_view(name: string, content: string) {
  const view_path = path.join(OUTPUT_DIR, name + '/src', "App.vue");
  console.log(view_path)

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
  const server_path = path.join(OUTPUT_DIR, name, "server.ts");

  try {
    await access(server_path);
    await write(server_path, content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`App.vue not found in the specified template directory: ${server_path}`);
    }

    throw new Error(`File system error occurred for template ${name}.`);
  }
}


serve({
  port: 5001,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/create/template' && req.method === "POST") {
      const payload = await req.json();
      const name = payload.name?.trim();

      if (!name || /[\/\\]/.test(name)) {
        return new Response("Invalid template name", { status: 400 });
      }

      await create_template(name);

      return new Response(`http://localhost:5000/${name}/1.0.0/~preview/?__ocAcceptLanguage=*&userId=1`);
    }

    if (url.pathname === '/update/template' && req.method === "POST") {
      const payload = await req.json();
      const name = payload.name?.trim();
      const { view, server } = payload;

      if (!name || /[\/\\]/.test(name)) {
        return new Response("Invalid template name", { status: 400 });
      }
      if (view) await update_view(name, view);
      if (server) await update_server(name, server);

      if (view || server) {
        const targetDir = path.join(OUTPUT_DIR, name);
        await run_command("pnpm", ["build"], targetDir);
      }

      return new Response(
        JSON.stringify({ message: `Template '${name}' updated successfully.` }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  },
});

console.log("Server running on http://localhost:5001");