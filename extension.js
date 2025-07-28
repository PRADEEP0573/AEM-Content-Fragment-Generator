const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

let currentPanel = undefined;

function activate(context) {
    let disposable = vscode.commands.registerCommand('aem-cf-builder.createModel', async (uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('Please right-click on a folder in the Explorer to use this command');
            return;
        }

        // Get configuration with default values
        const config = vscode.workspace.getConfiguration('aemCfGenerator');
        const fieldTypes = config.get('fieldTypes', [
            { label: 'Single Line Text', value: 'text-single' },
            { label: 'Multi-line Text', value: 'text-multi' },
            { label: 'Number', value: 'number' },
            { label: 'Boolean', value: 'boolean' },
            { label: 'Date/Time', value: 'datetime' },
            { label: 'Enumeration', value: 'enumeration' }
        ]);
        const validationTypes = config.get('validationTypes', [
            { label: 'Required', value: 'required' },
            { label: 'Optional', value: 'optional' }
        ]);
        const defaultFields = config.get('defaultFields', []);

        currentPanel = vscode.window.createWebviewPanel(
            'aemCfBuilder',
            'AEM Content Fragment Builder',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
            }
        );

        currentPanel.webview.html = getWebviewContent(fieldTypes, validationTypes, defaultFields);

        currentPanel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    switch (message.command) {
                        case 'generate':
                            await generateContentFragment(message.data, uri);
                            break;
                        case 'preview':
                            updatePreview(message.data);
                            break;
                        case 'validate':
                            const validation = validateInput(message.data);
                            if (!validation.isValid) {
                                currentPanel.webview.postMessage({
                                    command: 'validationError',
                                    message: validation.message
                                });
                            } else {
                                currentPanel.webview.postMessage({
                                    command: 'validationSuccess'
                                });
                            }
                            break;
                        default:
                            console.warn('Unknown message command:', message.command);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error: ${error.message}`);
                    console.error(error);
                }
            },
            undefined,
            context.subscriptions
        );

        currentPanel.onDidDispose(
            () => {
                currentPanel = undefined;
            },
            null,
            context.subscriptions
        );
    });

    context.subscriptions.push(disposable);
}

function validateInput(data) {
    if (!data.name) {
        return {
            isValid: false,
            message: 'Model name is required'
        };
    }

    if (!/^[a-z0-9-_]+$/i.test(data.name)) {
        return {
            isValid: false,
            message: 'Model name can only contain letters, numbers, hyphens and underscores'
        };
    }

    if (!data.fields || data.fields.length === 0) {
        return {
            isValid: false,
            message: 'At least one field is required'
        };
    }

    for (const field of data.fields) {
        if (!field.name || !field.type) {
            return {
                isValid: false,
                message: 'All fields must have a name and type'
            };
        }
        
        if (!/^[a-z][a-z0-9-_]*$/i.test(field.name)) {
            return {
                isValid: false,
                message: `Field name '${field.name}' must start with a letter and contain only letters, numbers, hyphens or underscores`
            };
        }
    }

    return { isValid: true };
}

async function generateContentFragment(data, uri) {
    try {
        const basePath = uri.fsPath;
        const modelName = data.name.toLowerCase().replace(/\s+/g, '-');
        const projectName = data.projectName || 'myproject';
        const folderName = data.folderName || 'CF Folder Name';

        // Validate project name
        if (!/^[a-z0-9-]+$/.test(projectName)) {
            vscode.window.showErrorMessage('Project name can only contain lowercase letters, numbers, and hyphens');
            return;
        }

        // Validate folder name
        if (!folderName || folderName.trim().length === 0) {
            vscode.window.showErrorMessage('Folder name cannot be empty');
            return;
        }

        // Create the complete folder structure
        const rootFolder = path.join(basePath, folderName);
        const settingsPath = path.join(rootFolder, 'settings');
        const damPath = path.join(settingsPath, 'dam');
        const cfmPath = path.join(damPath, 'cfm');
        const modelsPath = path.join(cfmPath, 'models');
        const modelPath = path.join(modelsPath, modelName);

        // Create all directories
        fs.mkdirSync(modelPath, { recursive: true });

        // Create all .content.xml files
        // 1. Root .content.xml
        const rootContent = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" 
          xmlns:jcr="http://www.jcp.org/jcr/1.0"
          jcr:title="${escapeXml(data.name)}"
          jcr:primaryType="sling:Folder"/>`;

        // 2. settings/.content.xml
        const settingsContent = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" 
          xmlns:jcr="http://www.jcp.org/jcr/1.0"
          jcr:primaryType="sling:Folder"
          sling:resourceType="sling:Folder"/>`;

        // 3. settings/dam/.content.xml
        const damContent = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" 
          xmlns:jcr="http://www.jcp.org/jcr/1.0"
          jcr:primaryType="cq:Page">
    <cfm/>
</jcr:root>`;

        // 4. settings/dam/cfm/.content.xml
        const cfmContent = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" 
          xmlns:jcr="http://www.jcp.org/jcr/1.0"
          jcr:primaryType="cq:Page">
    <models/>
</jcr:root>`;

        // 5. settings/dam/cfm/models/.content.xml
        const modelsContent = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" 
          xmlns:jcr="http://www.jcp.org/jcr/1.0"
          jcr:primaryType="cq:Page">
    <${modelName}/>
</jcr:root>`;

        // 6. settings/dam/cfm/models/[model-name]/.content.xml
        const modelContent = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
 xmlns:cq="http://www.day.com/jcr/cq/1.0" 
 xmlns:jcr="http://www.jcp.org/jcr/1.0" 
 xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
 xmlns:granite="http://www.adobe.com/jcr/granite/1.0"
    jcr:primaryType="cq:Template"
    allowedPaths="[/content/entities(/.*)?]"
    ranking="{Long}100">
    <jcr:content
        cq:lastModified="{Date}${new Date().toISOString()}"
        cq:lastModifiedBy="{String}admin"
        cq:scaffolding="/conf/${projectName}/settings/dam/cfm/models/${modelName}/jcr:content/model"
        cq:templateType="/libs/settings/dam/cfm/model-types/fragment"
        jcr:primaryType="cq:PageContent"
        jcr:title="${escapeXml(data.name)}"
        sling:resourceSuperType="dam/cfm/models/console/components/data/entity"
        sling:resourceType="dam/cfm/models/console/components/data/entity/default">
        <model
            cq:targetPath="/content/entities"
            jcr:primaryType="cq:PageContent"
            sling:resourceType="wcm/scaffolding/components/scaffolding"
            dataTypesConfig="/mnt/overlay/settings/dam/cfm/models/formbuilderconfig/datatypes"
            maxGeneratedOrder="20">
            <cq:dialog
                jcr:primaryType="nt:unstructured"
                sling:resourceType="cq/gui/components/authoring/dialog">
                <content
                    jcr:lastModified="{Date}${new Date().toISOString()}"
                    jcr:lastModifiedBy="admin"
                    jcr:primaryType="nt:unstructured"
                    sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns">
                    <items
                        jcr:primaryType="nt:unstructured"
                        maxGeneratedOrder="22">
                        ${generateFieldsXml(data.fields)}
                    </items>
                </content>
            </cq:dialog>
        </model>
    </jcr:content>
</jcr:root>`;

        // Write all files
        fs.writeFileSync(path.join(rootFolder, '.content.xml'), rootContent);
        fs.writeFileSync(path.join(settingsPath, '.content.xml'), settingsContent);
        fs.writeFileSync(path.join(damPath, '.content.xml'), damContent);
        fs.writeFileSync(path.join(cfmPath, '.content.xml'), cfmContent);
        fs.writeFileSync(path.join(modelsPath, '.content.xml'), modelsContent);
        fs.writeFileSync(path.join(modelPath, '.content.xml'), modelContent);

        vscode.window.showInformationMessage(
            `Content Fragment Model '${data.name}' created successfully at: ${modelPath}`
        );

        // Open the generated files
        const rootUri = vscode.Uri.file(path.join(rootFolder, '.content.xml'));
        const modelUri = vscode.Uri.file(path.join(modelPath, '.content.xml'));
        
        await vscode.window.showTextDocument(rootUri);
        await vscode.window.showTextDocument(modelUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });

    } catch (error) {
        vscode.window.showErrorMessage(`Error creating Content Fragment Model: ${error.message}`);
        console.error('Error in generateContentFragment:', error);
    }
}

function generateFieldsXml(fields) {
    return fields.map((field, index) => {
        const fieldId = `_x003${index}_${Date.now()}`;
        const commonAttrs = [
            `jcr:primaryType="nt:unstructured"`,
            `fieldLabel="${escapeXml(field.label || field.name)}"`,
            `fieldDescription="${escapeXml(field.description || '')}"`,
            `name="${escapeXml(field.name)}"`,
            `listOrder="${index + 1}"`,
            `metaType="${field.type}"`,
            `renderReadOnly="false"`,
            `showEmptyInReadOnly="true"`,
            `required="${field.required ? 'on' : 'off'}"`
        ];

        let fieldAttrs = [...commonAttrs];
        
        // Add type-specific attributes
        switch(field.type) {
            case 'text-single':
                fieldAttrs.push(
                    `sling:resourceType="granite/ui/components/coral/foundation/form/textfield"`,
                    `emptyText="${escapeXml(field.placeholder || '')}"`,
                    `maxlength="${field.maxLength || '255'}"`,
                    `valueType="string"`,
                    `value="${escapeXml(field.value || '')}"`
                );
                break;

            case 'text-multi':
                fieldAttrs.push(
                    `sling:resourceType="dam/cfm/admin/components/authoring/contenteditor/multieditor"`,
                    `default-mime-type="text/html"`,
                    `valueType="string"`
                );
                break;

            case 'number':
                fieldAttrs.push(
                    `sling:resourceType="granite/ui/components/coral/foundation/form/numberfield"`,
                    `emptyText="${escapeXml(field.placeholder || '')}"`,
                    `step="${field.step || '1'}"`,
                    `typeHint="${field.numberType || 'long'}"`,
                    `valueType="${field.numberType || 'long'}"`,
                    `value="${field.value || '0'}"`
                );
                break;

            case 'boolean':
                fieldAttrs.push(
                    `sling:resourceType="granite/ui/components/coral/foundation/form/checkbox"`,
                    `checked="{Boolean}${field.checked || 'false'}"`,
                    `text="${escapeXml(field.text || field.label || field.name)}"`,
                    `valueType="boolean"`
                );
                break;

            case 'date':
                fieldAttrs.push(
                    `sling:resourceType="granite/ui/components/coral/foundation/form/datepicker"`,
                    `displayedFormat="YYYY-MM-DD HH:mm"`,
                    `emptyText="YYYY-MM-DD HH:mm"`,
                    `type="datetime"`,
                    `valueFormat="YYYY-MM-DD[T]HH:mm:ss.000Z"`,
                    `valueType="calendar"`,
                    `value="${field.value ? `{Date}${field.value}` : ''}"`,
                    `>`,
                    `<granite:data jcr:primaryType="nt:unstructured" typeHint="Date"/>`
                );
                return `<${fieldId} ${fieldAttrs.join(' ')}</${fieldId}>`;

            case 'enumeration':
                fieldAttrs.push(
                    `sling:resourceType="granite/ui/components/coral/foundation/form/select"`,
                    `emptyOption="{Boolean}true"`,
                    `options="${escapeXml(field.options ? field.options.join(',') : 'Option 1,Option 2')}"`,
                    `valueType="string"`,
                    `>`,
                    `<datasource jcr:primaryType="nt:unstructured"`,
                    `sling:resourceType="dam/cfm/admin/components/datasources/optionrenderer"`,
                    `variant="default"/>`
                );
                return `<${fieldId} ${fieldAttrs.join(' ')}</${fieldId}>`;

            default:
                fieldAttrs.push(
                    `sling:resourceType="granite/ui/components/coral/foundation/form/textfield"`,
                    `valueType="string"`
                );
        }

        return `<${fieldId} ${fieldAttrs.join(' ')}/>`;
    }).join('\n        ');
}

function getWebviewContent(fieldTypes = [], validationTypes = [], defaultFields = []) {
    // Generate field type options
    const fieldTypeOptions = fieldTypes.map(type => 
        `<option value="${type.value}">${type.label}</option>`
    ).join('\n');

    // Generate validation type options
    const validationTypeOptions = validationTypes.map(validation => 
        `<option value="${validation.value}">${validation.label}</option>`
    ).join('\n');

    // Generate default fields HTML
    const defaultFieldsHtml = defaultFields
        .map((field, index) => generateFieldHtml(field, index, fieldTypes, validationTypes))
        .join('');

    // Generate the complete HTML content
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AEM Content Fragment Builder</title>
    <style>
        /* Modern Color Scheme */
        :root {
            --primary: #7c3aed;
            --primary-light: #a78bfa;
            --secondary: #10b981;
            --accent: #f59e0b;
            --danger: #ef4444;
            --success: #10b981;
            --text: #1f2937;
            --text-light: #6b7280;
            --bg: #f9fafb;
            --card-bg: #ffffff;
            --border: #e5e7eb;
            
            /* Spacing */
            --spacing-xs: 4px;
            --spacing-sm: 8px;
            --spacing-md: 16px;
            --spacing-lg: 24px;
            --spacing-xl: 32px;
            
            /* Border Radius */
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;
            
            /* Shadows */
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            
            /* Transitions */
            --transition-fast: all 0.15s ease-in-out;
            --transition-normal: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            --transition-slow: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Base Styles */
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: var(--text);
            background: url('https://github.com/PRADEEP0573/AEM-Content-Fragment-Generator/blob/main/images/PADDE.png');
            background-color: #f9fafb;
            background-repeat: no-repeat;
            background-size: cover;
            background-position: center;
            margin: 0;
            padding: 0;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        /* Container */
        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: var(--spacing-xl);
            animation: fadeIn 0.6s ease-out;
        }

        /* Card */
        .card {
            background: var(--card-bg);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            padding: var(--spacing-xl);
            margin-bottom: var(--spacing-xl);
            border: 1px solid var(--border);
            transition: var(--transition-normal);
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }

        /* Form Elements */
        .form-group {
            margin-bottom: var(--spacing-lg);
        }

        label {
            display: block;
            margin-bottom: var(--spacing-sm);
            font-weight: 600;
            color: var(--text);
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        input[type="text"],
        select {
            width: 100%;
            padding: 10px 12px;
            background-color: var(--card-bg);
            color: var(--text);
            border: 2px solid var(--border);
            border-radius: var(--radius-md);
            font-family: inherit;
            font-size: 14px;
            transition: var(--transition-fast);
        }

        input[type="text"]:focus,
        select:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }

        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 10px 16px;
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            transition: var(--transition-normal);
            box-shadow: var(--shadow-sm);
        }

        .btn:hover {
            transform: translateY(-1px);
            box-shadow: var(--shadow-md);
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn-remove {
            background: linear-gradient(135deg, #ef4444 0%, #f87171 100%);
        }

        .btn-secondary {
            background: var(--bg);
            color: var(--text);
            border: 1px solid var(--border);
        }

        /* Field Rows */
        .field-row {
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-sm);
            padding: var(--spacing-md);
            background: var(--card-bg);
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            transition: var(--transition-normal);
            animation: slideIn 0.3s ease-out;
        }

        .field-row:hover {
            border-color: var(--primary);
            box-shadow: var(--shadow-sm);
        }

        .field-name { flex: 2; }
        .field-type { flex: 2; }
        .field-validation { flex: 1.5; }
        .field-default { flex: 1.5; }

        /* Error Message */
        #error-message {
            color: #b91c1c;
            background-color: #fef2f2;
            border-left: 4px solid #dc2626;
            padding: 12px 16px;
            margin: 0 0 24px 0;
            border-radius: 4px;
            display: none;
            font-size: 14px;
            line-height: 1.5;
            animation: fadeIn 0.3s ease-out;
        }

        /* Preview Section */
        #preview-container {
            margin-top: var(--spacing-xl);
            display: none;
            animation: fadeIn 0.6s ease-out;
        }

        #preview-content {
            background: var(--bg);
            padding: var(--spacing-lg);
            border-radius: var(--radius-md);
            max-height: 400px;
            overflow: auto;
            white-space: pre-wrap;
            font-family: 'Fira Code', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.5;
            border: 1px solid var(--border);
        }

        /* Animations */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slideIn {
            from { opacity: 0; transform: translateX(-10px); }
            to { opacity: 1; transform: translateX(0); }
        }

        /* Utility Classes */
        .flex {
            display: flex;
            gap: var(--spacing-md);
        }

        .items-center {
            align-items: center;
        }

        .justify-between {
            justify-content: space-between;
        }

        .mt-4 { margin-top: var(--spacing-md); }
        .mb-4 { margin-bottom: var(--spacing-md); }
        .p-4 { padding: var(--spacing-md); }

        /* Responsive Design */
        @media (max-width: 768px) {
            :root {
                --spacing-md: 12px;
                --spacing-lg: 16px;
                --spacing-xl: 20px;
            }

            .container {
                padding: var(--spacing-md);
            }

            .form-row {
                flex-direction: column;
                gap: var(--spacing-md);
            }

            .field-row {
                flex-direction: column;
                gap: var(--spacing-sm);
                padding: var(--spacing-md);
            }

            .field-name,
            .field-type,
            .field-validation,
            .field-default,
            .field-options-container {
                width: 100%;
            }

            .form-actions {
                flex-direction: column;
                gap: var(--spacing-sm);
            }

            .btn {
                width: 100%;
                padding: 12px;
            }

            #preview-content {
                max-height: 300px;
                font-size: 12px;
                padding: var(--spacing-md);
            }
        }

        @media (max-width: 480px) {
            :root {
                --spacing-sm: 6px;
                --spacing-md: 10px;
                --spacing-lg: 14px;
            }

            .card {
                padding: var(--spacing-lg);
                margin-bottom: var(--spacing-lg);
            }

            h1 {
                font-size: 1.5rem;
                margin-bottom: var(--spacing-lg);
            }

            label {
                font-size: 12px;
                margin-bottom: 4px;
            }

            input[type="text"],
            select {
                padding: 8px 10px;
                font-size: 13px;
            }
        }
    </style>
    <body>
        <div class="container">
            <h1>AEM Content Fragment Generator</h1>
            <div id="error-message" role="alert"></div>
            <div class="form-row">
                <div class="form-group">
                    <label for="projectName">Project Name</label>
                    <input type="text" 
                           id="projectName" 
                           placeholder="Enter Current Project Name" 
                           value=""
                           class="form-control" required />
                </div>
            </div>  
            <div class="form-row">
                <div class="form-group">
                    <label for="folderName">CF Folder Name</label>
                    <input type="text" 
                           id="folderName" 
                           placeholder="Enter CF Folder Name" 
                           value=""
                           class="form-control" required />
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="modelName">Model Name</label>
                    <input type="text" 
                           id="modelName" 
                           placeholder="Enter CF Model Name" 
                           class="form-control" required />
                </div>
            </div>
            
            <div class="form-group">
                <div class="form-group-header">
                    <label>Fields</label>
                    <button id="add-field" class="btn">+ Add Field</button>
                </div>
                <div id="fields-container">
                    ${defaultFieldsHtml}
                </div>
            </div>
            
            <div class="form-actions">
                <button id="preview" class="btn">Preview</button>
                <button id="generate" class="btn btn-primary">Generate</button>
            </div>
            
            <div id="preview-container">
                <h3>Preview</h3>
                <pre id="preview-content"></pre>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let fieldCounter = ${defaultFields.length};
            
            // Add new field
            document.getElementById('add-field').addEventListener('click', addNewField);
            
            // Handle field type change
            document.addEventListener('change', (e) => {
                if (e.target.classList.contains('field-type')) {
                    const fieldRow = e.target.closest('.field-row');
                    const optionsContainer = fieldRow.querySelector('.field-options-container');
                    
                    if (e.target.value === 'enumeration') {
                        if (!optionsContainer) {
                            const optionsInput = document.createElement('input');
                            optionsInput.type = 'text';
                            optionsInput.className = 'field-options';
                            optionsInput.placeholder = 'Option 1, Option 2, Option 3';
                            optionsInput.value = fieldRow.dataset.options || '';
                            
                            const container = document.createElement('div');
                            container.className = 'field-options-container';
                            const label = document.createElement('label');
                            label.textContent = 'Options (comma separated)';
                            container.appendChild(label);
                            container.appendChild(optionsInput);
                            
                            const validationSelect = fieldRow.querySelector('.field-validation');
                            fieldRow.insertBefore(container, validationSelect.nextSibling);
                        }
                    } else if (optionsContainer) {
                        optionsContainer.remove();
                    }
                }
            });
            
            // Remove field
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-field')) {
                    e.target.closest('.field-row').remove();
                }
            });
            
            // Preview button
            document.getElementById('preview').addEventListener('click', () => {
                const modelData = getModelData();
                if (modelData) {
                    document.getElementById('preview-content').textContent = 
                        JSON.stringify(modelData, null, 2);
                    document.getElementById('preview-container').style.display = 'block';
                    
                    // Post message to extension for any additional processing
                    vscode.postMessage({
                        command: 'preview',
                        data: modelData
                    });
                }
            });
            
            // Generate button
            document.getElementById('generate').addEventListener('click', generateModel);
            
            // Handle keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    generateModel();
                }
            });

            // Handle validation responses
            window.addEventListener('message', handleMessage);

            function addNewField() {
                const fieldRow = document.createElement('div');
                fieldRow.className = 'field-row';
                fieldRow.dataset.index = fieldCounter++;
                fieldRow.innerHTML = \`
                    <input type="text" 
                           class="field-name" 
                           placeholder="Field name" 
                           required />
                    <select class="field-type">
                        ${fieldTypeOptions}
                    </select>
                    <select class="field-validation">
                        ${validationTypeOptions}
                    </select>
                    <input type="text" 
                           class="field-default" 
                           placeholder="Default value" />
                    <button type="button" 
                            class="btn btn-remove remove-field" 
                            title="Remove field">
                        Remove
                    </button>
                \`;
                document.getElementById('fields-container').appendChild(fieldRow);
                fieldRow.querySelector('.field-name').focus();
            }

            function generateModel() {
                const modelData = getModelData();
                if (modelData) {
                    vscode.postMessage({
                        command: 'validate',
                        data: modelData
                    });
                }
            }

            function handleMessage(event) {
                const message = event.data;
                const errorEl = document.getElementById('error-message');
                
                switch (message.command) {
                    case 'validationError':
                        errorEl.textContent = message.message;
                        errorEl.style.display = 'block';
                        errorEl.scrollIntoView({ behavior: 'smooth' });
                        break;
                        
                    case 'validationSuccess':
                        errorEl.style.display = 'none';
                        vscode.postMessage({
                            command: 'generate',
                            data: getModelData()
                        });
                        break;
                }
            }

            function validateForm() {
                const projectName = document.getElementById('projectName').value.trim();
                const folderName = document.getElementById('folderName').value.trim();
                const modelName = document.getElementById('modelName').value.trim();
                
                // Reset error state
                document.getElementById('error-message').style.display = 'none';
                
                // Validate project name
                if (!projectName) {
                    showError('Project name is required');
                    document.getElementById('projectName').focus();
                    return false;
                }
                
                if (!/^[a-z0-9-]+$/.test(projectName)) {
                    showError('Project name can only contain lowercase letters, numbers, and hyphens');
                    document.getElementById('projectName').focus();
                    return false;
                }
                
                // Validate folder name
                if (!folderName) {
                    showError('Folder name is required');
                    document.getElementById('folderName').focus();
                    return false;
                }
                
                // Validate model name
                if (!modelName) {
                    showError('Model name is required');
                    document.getElementById('modelName').focus();
                    return false;
                }
                
                return true;
            }

            function getModelData() {
                if (!validateForm()) {
                    return null;
                }
                
                const modelName = document.getElementById('modelName').value.trim();
                const projectName = document.getElementById('projectName').value.trim();
                const folderName = document.getElementById('folderName').value.trim();
                
                const fields = Array.from(document.querySelectorAll('.field-row'))
                    .map(row => {
                        const name = row.querySelector('.field-name').value.trim();
                        const type = row.querySelector('.field-type').value;
                        const validation = row.querySelector('.field-validation').value;
                        const defaultValue = row.querySelector('.field-default').value.trim();
                        const optionsInput = row.querySelector('.field-options');
                        const options = optionsInput ? optionsInput.value.split(',').map(opt => opt.trim()).filter(opt => opt) : [];
                        
                        const field = { 
                            name, 
                            type, 
                            validation, 
                            defaultValue,
                            ...(type === 'enumeration' && { options })
                        };
                        
                        return field;
                    })
                    .filter(field => field.name && field.type);

                if (fields.length === 0) {
                    showError('At least one field is required');
                    return null;
                }

                return {
                    name: modelName,
                    projectName,
                    folderName,
                    fields
                };
            }

            function showError(message) {
                const errorEl = document.getElementById('error-message');
                errorEl.textContent = message;
                errorEl.style.display = 'block';
                errorEl.scrollIntoView({ behavior: 'smooth' });
            }
        </script>
    </body>
</html>`;
}

// Helper function to generate field HTML
function generateFieldHtml(field, index, fieldTypes, validationTypes) {
    const optionsValue = field.options ? field.options.join(', ') : '';
    
    return `
        <div class="field-row" data-index="${index}" ${field.options ? 'data-options="' + escapeHtml(optionsValue) + '"' : ''}>
            <input type="text" 
                   class="field-name" 
                   value="${escapeHtml(field.name || '')}" 
                   placeholder="Field name" 
                   required />
            <select class="field-type">
                ${fieldTypes.map(type => `
                    <option value="${type.value}" 
                            ${type.value === (field.type || '') ? 'selected' : ''}>
                        ${type.label}
                    </option>
                `).join('')}
            </select>
            ${field.type === 'enumeration' ? `
                <div class="field-options-container">
                    <label>Options (comma separated)</label>
                    <input type="text" 
                           class="field-options" 
                           value="${escapeHtml(optionsValue)}" 
                           placeholder="Option 1, Option 2, Option 3" />
                </div>
            ` : ''}
            <select class="field-validation">
                ${validationTypes.map(validation => `
                    <option value="${validation.value}" 
                            ${validation.value === (field.validation || '') ? 'selected' : ''}>
                        ${validation.label}
                    </option>
                `).join('')}
            </select>
            <input type="text" 
                   class="field-default" 
                   value="${escapeHtml(field.defaultValue || '')}" 
                   placeholder="Default value" />
            <button type="button" 
                    class="btn btn-remove remove-field" 
                    title="Remove field">
                Remove
            </button>
        </div>
    `;
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function updatePreview(data) {
    if (currentPanel) {
        currentPanel.webview.postMessage({
            command: 'updatePreview',
            data: JSON.stringify(data, null, 2)
        });
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};