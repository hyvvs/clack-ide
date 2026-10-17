$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.mode -eq 'parse') {
        $tokens = $null
        $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($request.command, [ref]$tokens, [ref]$errors)
        if ($errors.Count -or $ast.ParamBlock -or $ast.BeginBlock -or $ast.ProcessBlock -or $ast.DynamicParamBlock -or $ast.ScriptRequirements -or $ast.UsingStatements.Count -or $ast.EndBlock.Traps.Count) { throw 'Unsupported script structure' }
        $commands = @()
        foreach ($statement in $ast.EndBlock.Statements) {
            if ($statement -isnot [System.Management.Automation.Language.PipelineAst] -or $statement.Background -or $statement.PipelineElements.Count -gt 2) { throw 'Only literal cmdlets or literal file-output pipelines are supported' }
            $literalInput = $null
            if ($statement.PipelineElements.Count -eq 2) {
                $head = $statement.PipelineElements[0]
                if ($head -isnot [System.Management.Automation.Language.CommandExpressionAst] -or $head.Redirections.Count) { throw 'Pipeline input must be literal data, not a command' }
                $expressions = @($head.Expression)
                if ($head.Expression -is [System.Management.Automation.Language.ArrayLiteralAst]) { $expressions = @($head.Expression.Elements) }
                $literalInput = @()
                foreach ($expression in $expressions) {
                    if ($expression -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { throw 'Pipeline input must contain only literal strings' }
                    $literalInput += $expression.Value
                }
                if ($literalInput.Count -gt 512) { throw 'Literal pipeline exceeds bound' }
            }
            $command = $statement.PipelineElements[$statement.PipelineElements.Count - 1]
            if ($command -isnot [System.Management.Automation.Language.CommandAst] -or $command.InvocationOperator.ToString() -ne 'Unknown' -or $command.Redirections.Count) { throw 'Invocation or redirection is unsupported' }
            $elements = @()
            foreach ($element in $command.CommandElements) {
                if ($element -is [System.Management.Automation.Language.CommandParameterAst]) {
                    if ($element.Argument) { throw 'Inline parameter expressions are unsupported' }
                    $elements += @{ kind = 'parameter'; value = $element.ParameterName }
                } elseif ($element -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
                    $elements += @{ kind = 'literal'; value = $element.Value }
                } else { throw 'Dynamic or nonliteral command element is unsupported' }
            }
            if ($null -ne $literalInput) { $elements += @{ kind = 'pipeline-input'; value = $literalInput } }
            $commands += ,$elements
        }
        if ($commands.Count -lt 1 -or $commands.Count -gt 16) { throw 'Command count exceeds policy' }
        @{ commands = $commands } | ConvertTo-Json -Depth 10 -Compress
    } elseif ($request.mode -eq 'inspect') {
        $inspected = @()
        $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        $walked = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        $root = [System.IO.Path]::GetFullPath($request.root)
        function Inspect-Entry([string]$target) {
            $attributes = [System.IO.File]::GetAttributes($target)
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point: $target" }
            return $attributes
        }
        $null = Inspect-Entry $root
        $null = Inspect-Entry ([System.IO.Path]::Combine($root, '.git'))
        foreach ($scope in $request.scopes) {
            $target = [System.IO.Path]::GetFullPath($scope.path)
            if (-not $target.StartsWith($root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Scope outside scratch root' }
            $ancestor = $target
            while ($ancestor -and $ancestor -ne $root) {
                if ([System.IO.File]::Exists($ancestor) -or [System.IO.Directory]::Exists($ancestor)) { $null = Inspect-Entry $ancestor }
                $ancestor = [System.IO.Path]::GetDirectoryName($ancestor)
            }
            $stack = [System.Collections.Generic.Stack[string]]::new()
            if ([System.IO.File]::Exists($target) -or [System.IO.Directory]::Exists($target)) { $stack.Push($target) }
            while ($stack.Count) {
                $current = $stack.Pop()
                $first = $seen.Add($current)
                if ($seen.Count -gt 8192) { throw 'Filesystem inspection exceeds bound' }
                $attributes = Inspect-Entry $current
                if ([System.IO.Path]::GetFileName($current) -eq '.git') { throw 'Foreign repository metadata in effect scope' }
                if ($first) { $inspected += $current }
                if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
                    if ([System.IO.File]::Exists([System.IO.Path]::Combine($current, '.git')) -or [System.IO.Directory]::Exists([System.IO.Path]::Combine($current, '.git'))) { throw 'Nested repository boundary' }
                    if ($scope.recursive -and $walked.Add($current)) {
                        foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($current)) {
                            if ($stack.Count + $seen.Count -ge 8192) { throw 'Filesystem inspection exceeds bound' }
                            $stack.Push($entry)
                        }
                    }
                }
            }
        }
        @{ inspected = $inspected } | ConvertTo-Json -Depth 5 -Compress
    } else { throw 'Unknown inspection mode' }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
