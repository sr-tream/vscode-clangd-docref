import * as vscode from 'vscode';
import * as vscodelc from 'vscode-languageclient/node';

import type { ClangdApiV1, ClangdExtension } from '@clangd/vscode-clangd';

const CLANGD_EXTENSION = 'llvm-vs-code-extensions.vscode-clangd';
const CLANGD_API_VERSION = 1;

let featureInstance: OpenDocumentationFeature | undefined;

export async function activate(context: vscode.ExtensionContext) {
	featureInstance = new OpenDocumentationFeature(context);
}

export function deactivate() {
	featureInstance?.dispose();
}

namespace protocol {

	export interface SymbolInfo {
		name: string;
		containerName: string;
		usr: string;
		id?: string;
	}

	export interface SymbolInfoParams {
		textDocument: vscodelc.TextDocumentIdentifier;
		position: vscodelc.Position;
	}

	export namespace SymbolInfoRequest {
		export const type = 'textDocument/symbolInfo';
	}

} // namespace protocol

class OpenDocumentationFeature implements vscode.Disposable {
	private clangd: ClangdApiV1 | undefined;

	constructor(private context: vscode.ExtensionContext) {
		this.context.subscriptions.push(vscode.commands.registerCommand(
			'clangd.openDocumentation', this.openDocumentation, this));
	}
	dispose() { }

	async getClangd() {
		if (this.clangd == undefined || this.clangd.languageClient.state === vscodelc.State.Stopped) {
			const clangdExtension = vscode.extensions.getExtension<ClangdExtension>(CLANGD_EXTENSION);
			if (!clangdExtension) {
				throw new Error('Could not find clangd extension');
			}
			this.clangd = clangdExtension.exports.getApi(CLANGD_API_VERSION);
		}

		return this.clangd;
	}

	async getSymbolsUnderCursor(): Promise<Array<string>> {
		const editor = vscode.window.activeTextEditor;
		if (!editor)
			return [];

		const document = editor.document;
		const position = editor.selection.active;
		const request: protocol.SymbolInfoParams = {
			textDocument: { uri: document.uri.toString() },
			position: position,
		};

		const lc = (await this.getClangd()).languageClient;
		if (lc.state !== vscodelc.State.Running) return [];

		const reply = await lc.sendRequest<protocol.SymbolInfo[]>(
			protocol.SymbolInfoRequest.type, request);

		let result: Array<string> = [];
		reply.forEach(symbol => {
			if (symbol.name === null || symbol.name === undefined)
				return;

			if (symbol.containerName === null || symbol.containerName === undefined) {
				result.push(symbol.name);
				return;
			}

			const needComas =
				!symbol.containerName.endsWith('::') && !symbol.name.startsWith('::');
			result.push(symbol.containerName + (needComas ? '::' : '') + symbol.name);
		});

		return result;
	}

	async openDocumentation() {
		const symbols = await this.getSymbolsUnderCursor();
		if (symbols.length === 0)
			return;

		const config = vscode.workspace.getConfiguration('clangd');
		const docs = await config.get<object>('documentation');
		if (docs !== undefined) {
			for (const symbol of symbols) {
				for (const [key, value] of Object.entries(docs)) {
					let url = value as string;
					const match = symbol.match(new RegExp(key));
					if (match !== null && url.length > 0) {
						url = url.replace('{{symbol}}', symbol);
						for (let i = 0; i < match.length; ++i) {
							url = url.replace('{{match:' + i + '}}', match[i]);
						}
						vscode.env.openExternal(vscode.Uri.parse(url));
						return;
					}
				}
			}
		}
		vscode.window.showWarningMessage('No documentation found for ' + symbols);
	}
}
