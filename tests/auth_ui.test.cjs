const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness() {
  const nodes = new Map();
  let click;
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', type: 'password', value: '', checked: false,
      disabled: false, attributes: {}, values: {},
      querySelector: node,
      setAttribute(name, value) { this.attributes[name] = value; },
    });
    return nodes.get(selector);
  }
  const context = vm.createContext({
    document: {
      querySelector: node, getElementById: id => node('#' + id),
      addEventListener(event, fn) { if (event === 'click') click = fn; },
    },
    window: { addEventListener() {} }, location: { hash: '' }, setInterval() {},
    fetch: () => new Promise(() => {}),
    FormData: class { constructor(form) { this.form = form; } *[Symbol.iterator]() { yield* Object.entries(this.form.values); } },
    console, Intl, Date,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run("refresh=async()=>{};globalThis.requests=[];api=async(path,method,body)=>{requests.push({path,method,body});return {ok:true};};");
  return {node, run, click: button => click({target: {closest: () => button}})};
}

test('show/hide toggles only the typed field and updates accessibility state', async () => {
  const {node, run, click} = harness();
  run('renderAuth();');
  const html = node('#app').innerHTML;
  assert(html.includes('data-password-toggle="password"'));
  assert(html.includes('data-action="auth-forgot"'));
  const input = node('#password');
  input.id = 'password'; input.value = 'my typed password';
  node('label[for="password"]').textContent = 'Password';
  const button = node('#toggle'); button.dataset = {passwordToggle: 'password'};
  await click(button);
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'my typed password');
  assert.equal(button.textContent, 'Hide');
  assert.equal(button.attributes['aria-pressed'], 'true');
  await click(button);
  assert.equal(input.type, 'password');
  assert.equal(button.textContent, 'Show');
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(run('requests.length'), 0);
});

test('forgot password checks confirmation and returns to sign-in after reset', async () => {
  const {node, run, click} = harness();
  await click({dataset: {action: 'auth-forgot'}});
  assert(node('#app').innerHTML.includes('Send reset code'));
  await click({dataset: {action: 'auth-reset'}});
  const html = node('#app').innerHTML;
  assert(html.includes('Reset code'));
  assert(html.includes('data-password-toggle="confirm_password"'));
  assert(html.includes('code from your email'));
  assert(!html.includes('administrator'));
  const form = node('#auth-form');
  form.values = {email: 'member@example.com', code: 'one-time-code', password: 'new-password', confirm_password: 'different-password'};
  await form.onsubmit({preventDefault() {}, target: form});
  assert.equal(run('requests.length'), 0);
  assert.equal(node('.form-error').textContent, 'The passwords do not match.');
  form.values.confirm_password = 'new-password';
  await form.onsubmit({preventDefault() {}, target: form});
  assert.equal(run('requests[0].path'), 'password/reset');
  assert.equal(run('requests[0].body.code'), 'one-time-code');
  assert.equal(run('requests[0].body.confirm_password'), 'new-password');
  assert.equal(run('authMode'), 'login');
  assert.equal(run('state'), null);
  assert(node('#app').innerHTML.includes('Password updated. Sign in with your new password.'));
  assert(!node('#app').innerHTML.includes('one-time-code'));
});

test('invalid reset remains on form and permits retry', async () => {
  const {node, run} = harness();
  run("authMode='reset';renderAuth();api=async()=>{throw Error('The code has expired.');};");
  const form = node('#auth-form');
  form.values = {email: 'member@example.com', code: 'expired-code', password: 'new-password', confirm_password: 'new-password'};
  await form.onsubmit({preventDefault() {}, target: form});
  assert.equal(run('authMode'), 'reset');
  assert.equal(node('.form-error').textContent, 'The code has expired.');
  assert.equal(node('[type=submit]').disabled, false);
});

test('login and registration preserve the remember-me boolean', async () => {
  for (const mode of ['login', 'register']) for (const checked of [false, true]) {
    const {node, run} = harness();
    run(`authMode='${mode}';renderAuth();`);
    const form = node('#auth-form');
    form.values = {email: 'member@example.com', password: 'new-password'};
    node('#remember-me').checked = checked;
    await form.onsubmit({preventDefault() {}, target: form});
    assert.equal(run('requests[0].path'), mode);
    assert.equal(run('requests[0].body.remember_me'), checked);
    assert.equal(node('[type=submit]').disabled, false);
  }
});


test('email request advances to code entry and preserves the account email', async () => {
  const {node, run, click} = harness();
  await click({dataset:{action:'auth-forgot'}});
  assert(!node('#app').innerHTML.includes('id="password"'));
  run("api=async(path,method,body)=>{requests.push({path,method,body});return {message:'If an active account matches, check your email.'};};");
  const form=node('#auth-form');
  form.values={email:'member@example.com'};
  await form.onsubmit({preventDefault(){},target:form});
  assert.equal(run('requests[0].path'), 'password/forgot');
  assert.equal(run('authMode'),'reset');
  assert.equal(run('recoveryEmail'),'member@example.com');
  assert(node('#app').innerHTML.includes('value="member@example.com"'));
  assert(node('#app').innerHTML.includes('If an active account matches'));
  await click({dataset:{action:'auth-forgot'}});
  assert.equal(run('authMode'),'forgot');
  assert.equal(run('requests.length'),1);
});

test('unconfigured email keeps the request screen and shows an actionable error', async () => {
  const {node, run, click}=harness();
  await click({dataset:{action:'auth-forgot'}});
  run("api=async()=>{throw Error('Email recovery is not available yet.');};");
  const form=node('#auth-form');form.values={email:'member@example.com'};
  await form.onsubmit({preventDefault(){},target:form});
  assert.equal(run('authMode'),'forgot');
  assert.equal(node('.form-error').textContent,'Email recovery is not available yet.');
  assert.equal(node('[type=submit]').disabled,false);
});
