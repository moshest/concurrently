const EventEmitter = require('events');

const createFakeCommand = require('./flow-control/fixtures/fake-command');
const concurrently = require('./concurrently');

let spawn, kill, controllers, processes = [];
const create = (commands, options = {}) => concurrently(
    commands,
    Object.assign(options, { controllers, spawn, kill })
);

beforeEach(() => {
    processes = [];
    spawn = jest.fn(() => {
        const process = new EventEmitter();
        processes.push(process);
        process.pid = processes.length;
        return process;
    });
    kill = jest.fn();
    controllers = [{ handle: jest.fn(arg => arg) }, { handle: jest.fn(arg => arg) }];
});

it('fails if commands is not an array', () => {
    const bomb = () => create('foo');
    expect(bomb).toThrowError();
});

it('fails if no commands were provided', () => {
    const bomb = () => create([]);
    expect(bomb).toThrowError();
});

it('spawns all commands', () => {
    create(['echo', 'kill']);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith('echo', expect.objectContaining({}));
    expect(spawn).toHaveBeenCalledWith('kill', expect.objectContaining({}));
});

it('spawns commands up to configured limit at once', () => {
    create(['foo', 'bar', 'baz', 'qux'], { maxProcesses: 2 });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith('foo', expect.objectContaining({}));
    expect(spawn).toHaveBeenCalledWith('bar', expect.objectContaining({}));

    // Test out of order completion picking up new processes in-order
    processes[1].emit('close', 1, null);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledWith('baz', expect.objectContaining({}));

    processes[0].emit('close', null, 'SIGINT');
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(spawn).toHaveBeenCalledWith('qux', expect.objectContaining({}));

    // Shouldn't attempt to spawn anything else.
    processes[2].emit('close', 1, null);
    expect(spawn).toHaveBeenCalledTimes(4);
});

it('runs controllers with the commands', () => {
    create(['echo', '"echo wrapped"']);

    controllers.forEach(controller => {
        expect(controller.handle).toHaveBeenCalledWith([
            expect.objectContaining({ command: 'echo', index: 0 }),
            expect.objectContaining({ command: 'echo wrapped', index: 1 }),
        ]);
    });
});

it('runs commands with a name or prefix color', () => {
    create([
        { command: 'echo', prefixColor: 'red', name: 'foo' },
        'kill'
    ]);

    controllers.forEach(controller => {
        expect(controller.handle).toHaveBeenCalledWith([
            expect.objectContaining({ command: 'echo', index: 0, name: 'foo', prefixColor: 'red' }),
            expect.objectContaining({ command: 'kill', index: 1, name: '', prefixColor: '' }),
        ]);
    });
});

it('passes commands wrapped from a controller to the next one', () => {
    const fakeCommand = createFakeCommand('banana', 'banana');
    controllers[0].handle.mockReturnValue([fakeCommand]);

    create(['echo']);

    expect(controllers[0].handle).toHaveBeenCalledWith([
        expect.objectContaining({ command: 'echo', index: 0 })
    ]);

    expect(controllers[1].handle).toHaveBeenCalledWith([fakeCommand]);

    expect(fakeCommand.start).toHaveBeenCalledTimes(1);
});

it('merges extra env vars into each command', () => {
    create([
        { command: 'echo', env: { foo: 'bar' } },
        { command: 'echo', env: { foo: 'baz' } },
        'kill'
    ]);

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledWith('echo', expect.objectContaining({
        env: expect.objectContaining({ foo: 'bar' })
    }));
    expect(spawn).toHaveBeenCalledWith('echo', expect.objectContaining({
        env: expect.objectContaining({ foo: 'baz' })
    }));
    expect(spawn).toHaveBeenCalledWith('kill', expect.objectContaining({
        env: expect.not.objectContaining({ foo: expect.anything() })
    }));
});

it('uses cwd from options for each command', () => {
    create(
        [
            { command: 'echo', env: { foo: 'bar' } },
            { command: 'echo', env: { foo: 'baz' } },
            'kill'
        ],
        {
            cwd: 'foobar',
        }
    );

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledWith('echo', expect.objectContaining({
        env: expect.objectContaining({ foo: 'bar' }),
        cwd: 'foobar',
    }));
    expect(spawn).toHaveBeenCalledWith('echo', expect.objectContaining({
        env: expect.objectContaining({ foo: 'baz' }),
        cwd: 'foobar',
    }));
    expect(spawn).toHaveBeenCalledWith('kill', expect.objectContaining({
        env: expect.not.objectContaining({ foo: expect.anything() }),
        cwd: 'foobar',
    }));
});
